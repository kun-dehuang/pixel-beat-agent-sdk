/**
 * Pixel Beat Agent V3
 * Claude Agent SDK 模式：自主决策 + 工具调用
 *
 * 架构：
 * - Claude: 决策中枢，自主决定调用哪些工具
 * - Gemini: VLM 工具，负责照片分析
 * - Memory Service: 记忆检索工具
 */

import Anthropic from "@anthropic-ai/sdk";
import { ToolHandlers } from "../tools";

// Agent 系统提示 - ReAct 决策框架
const SYSTEM_PROMPT = `你是 Pixel Beat，一个专业的朋友圈故事创作 Agent。你必须按照 ReAct (Reasoning + Acting) 框架进行结构化决策。

## 可用工具
1. **analyze_photos** - VLM分析照片内容（场景、情绪、实体、人物等）
2. **retrieve_memories** - 检索历史记忆，寻找叙事角度
3. **select_strategy** - 选择最佳叙事策略
4. **predict_engagement** - 预测故事互动效果（5维评分）

## ReAct 决策流程

### Step 1: OBSERVE（观察）
调用 analyze_photos 分析照片，提取关键信息。

### Step 2: THINK（思考记忆策略）
基于照片分析结果，决定是否检索记忆：

**检索条件（满足任一即检索）：**
- 照片中有高价值实体（品牌物品、收藏品、特殊物件）→ entity path
- 照片表达显著情绪（悲喜转换、意外情感）→ emotion path
- 照片在特定地点（餐厅、旅游景点、常去场所）→ location path

**不检索条件（满足任一则跳过）：**
- 普通日常内容（一般餐食、普通风景）
- 无明显情绪表达
- 无可识别的特殊实体
- 当前素材已足够丰富

### Step 3: ACT（执行记忆检索，可选）
如果 Step 2 决定检索，调用 retrieve_memories。
评估返回的记忆：
- confidence >= 0.75 → 必须使用
- 0.5 <= confidence < 0.75 → 酌情使用
- confidence < 0.5 → 不使用

### Step 4: THINK（选择叙事策略）
调用 select_strategy，基于素材评估四种策略的适用性：

**A. 时间对比型 (time_contrast)**
- 触发条件：memory_confidence > 0.75 且 有情感反差
- 结构："X个月前...，而现在..."
- 5维优势：memory ↑↑, gossip ↑

**B. 隐形炫耀型 (subtle_flex)**
- 触发条件：照片含品牌/成就/稀缺体验
- 结构：轻描淡写提及，不直接点破
- 5维优势：status ↑↑, class ↑

**C. 情绪捕捉型 (emotion_capture)**
- 触发条件：照片有明确情绪表达
- 结构：细节描写 + 情绪留白
- 5维优势：hotness ↑↑, gossip ↑

**D. 信息分享型 (value_share)**
- 触发条件：发现新事物/有实用信息
- 结构：经验分享 + 个人感受
- 5维优势：class ↑, status ↑

### Step 5: ACT（生成故事）
使用选定策略创作故事，确保：
- ✓ 第三人称（她/他，而非我）
- ✓ 具体细节（数字、颜色、动作、时间）
- ✓ 叙事张力（对比、反转、悬念）
- ✓ 留白结尾（不把话说满）
- ✓ 字数 80-150

### Step 6: REFLECT（自我评估）
调用 predict_engagement 评估故事质量。
如果评分 < 6.0，重新生成（最多1次）。

## 质量检查清单
□ 是否第三人称？（"她盯着..."而非"我盯着..."）
□ 是否有具体细节？（"第三杯拿铁"而非"一杯咖啡"）
□ 是否避免空话？（"嘴角微微上扬"而非"很开心"）
□ 是否有叙事张力？（包含"却"、"没想到"、"竟然"、"原来"等转折）
□ 是否留白？（结尾留有想象空间）
□ 字数是否在 80-150 之间？

## 输出格式
完成所有步骤后，输出 JSON：
{
  "status": "success",
  "reasoning": {
    "memory_decision": "检索/不检索，原因...",
    "memory_used": true/false,
    "strategy_choice": "策略名称",
    "strategy_reason": "选择该策略的原因...",
    "quality_check": ["✓第三人称", "✓具体细节", "✓叙事张力", "✓留白", "✓字数合格"]
  },
  "story": {
    "title": "故事标题（5-15字）",
    "body": "故事正文（80-150字）"
  },
  "discovery_angle": "time_contrast/subtle_flex/emotion_capture/value_share",
  "engagement_score": 7.5,
  "viral_breakdown": {
    "gossip": 6,
    "hotness": 7,
    "status": 8,
    "class": 7,
    "memory": 8
  },
  "likely_reactions": ["❤️", "😍", "👍"]
}`;

// Claude 工具定义
const CLAUDE_TOOLS: Anthropic.Tool[] = [
  {
    name: "analyze_photos",
    description: "【Step 1: OBSERVE】分析用户的照片内容，提取场景、情绪、实体、人物、地点等信息。\n\n照片数据已预加载，直接调用即可。",
    input_schema: {
      type: "object" as const,
      properties: {
        timeRange: {
          type: "string",
          description: "照片时间范围，如 '今日'、'本周'，默认为今日"
        }
      },
      required: []
    }
  },
  {
    name: "retrieve_memories",
    description: "【Step 3: ACT】基于照片分析结果，检索历史记忆。返回匹配的记忆及置信度。\n\n仅在 Step 2 决定检索时调用。置信度 >= 0.75 的记忆应被使用。",
    input_schema: {
      type: "object" as const,
      properties: {
        photoAnalysis: {
          type: "object",
          properties: {
            entities: { type: "array", items: { type: "string" }, description: "照片中的实体/物品" },
            people: { type: "array", items: { type: "string" }, description: "照片中的人物" },
            location: { type: "string", description: "地点" },
            emotion: { type: "string", description: "情绪" },
            activities: { type: "array", items: { type: "string" }, description: "活动" }
          },
          description: "从 analyze_photos 获得的分析结果"
        },
        paths: {
          type: "array",
          items: { type: "string", enum: ["entity", "emotion_echo", "emotion_contrast", "location", "person", "all"] },
          description: "检索路径：entity(实体延续)、emotion_echo(情感共鸣)、emotion_contrast(情感对比)、location(地点关联)、person(人物关联)"
        },
        topK: {
          type: "number",
          description: "返回的记忆数量，默认 3"
        },
        minConfidence: {
          type: "number",
          description: "最小置信度阈值，建议 0.5"
        }
      },
      required: ["photoAnalysis"]
    }
  },
  {
    name: "select_strategy",
    description: "【Step 4: THINK】选择最佳叙事策略。基于照片分析和记忆检索结果，评估四种策略的适用性并返回推荐。",
    input_schema: {
      type: "object" as const,
      properties: {
        photoFeatures: {
          type: "object",
          properties: {
            hasBrand: { type: "boolean", description: "是否有品牌物品" },
            hasAchievement: { type: "boolean", description: "是否展示成就" },
            hasRareExperience: { type: "boolean", description: "是否为稀缺体验" },
            emotionStrength: { type: "number", description: "情绪强度 0-10" },
            locationType: { type: "string", description: "地点类型：餐厅/户外/办公/居家/旅行" },
            hasUsefulInfo: { type: "boolean", description: "是否有实用信息价值" }
          },
          description: "照片特征摘要"
        },
        memoryMatch: {
          type: "object",
          properties: {
            found: { type: "boolean", description: "是否找到相关记忆" },
            confidence: { type: "number", description: "最高置信度" },
            angleType: { type: "string", description: "叙事角度类型" },
            timeGapDays: { type: "number", description: "与记忆的时间间隔（天）" },
            emotionContrast: { type: "boolean", description: "是否有情感反差" }
          },
          description: "记忆匹配结果"
        }
      },
      required: ["photoFeatures"]
    }
  },
  {
    name: "predict_engagement",
    description: "【Step 6: REFLECT】预测故事的互动效果，返回5维评分。用于自我评估，若评分 < 6.0 应考虑重写。",
    input_schema: {
      type: "object" as const,
      properties: {
        story: {
          type: "object",
          properties: {
            title: { type: "string", description: "故事标题" },
            body: { type: "string", description: "故事正文" },
            style: { type: "string", description: "故事风格" }
          },
          required: ["title", "body"],
          description: "要评估的故事"
        },
        strategyUsed: {
          type: "string",
          enum: ["time_contrast", "subtle_flex", "emotion_capture", "value_share"],
          description: "使用的叙事策略"
        },
        hasMemoryConnection: {
          type: "boolean",
          description: "是否使用了历史记忆"
        }
      },
      required: ["story", "strategyUsed"]
    }
  }
];

// Agent 输入
export interface AgentInput {
  userId: string;
  photos: Array<{ base64: string; mimeType?: string }>;
  existingPersona?: any;
  preferredStyle?: "natural" | "literary" | "humorous";
  generateStory?: boolean;
}

// Agent 输出
export interface AgentOutput {
  status: "success" | "error";
  discovery_angle?: string;
  reasoning?: string;
  photoAnalysis?: any;
  memory_connections?: Array<{
    angle_type: string;
    memory_id: string;
    description: string;
    confidence?: number;
  }>;
  persona?: any;
  story?: { title: string; body: string };
  engagement_score?: number;
  viral_breakdown?: {
    gossip: number;
    hotness: number;
    status: number;
    class: number;
    memory: number;
  };
  likely_reactions?: string[];
  style?: string;
  retryCount?: number;
  error?: string;
  debug?: {
    steps: string[];
    totalTokens: number;
    totalLatencyMs: number;
    turns: number;
  };
  // ✅ 新增：5轮迭代历史（ai-moments 返回）
  iteration_history?: Array<{
    iteration: number;
    caption: string;
    photoIds: string[];
    auditScore?: number;
    strategy?: string;
  }>;
}

/**
 * Pixel Beat Agent 类 - Claude Agent SDK 模式
 */
export class PixelBeatAgent {
  private anthropic: Anthropic;
  private toolHandlers: ToolHandlers;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.toolHandlers = new ToolHandlers();
    console.log("✅ Pixel Beat Agent V3 initialized (Claude Agent SDK)");
  }

  /**
   * 运行 Agent - Agentic Loop
   */
  async run(input: AgentInput): Promise<AgentOutput> {
    const startTime = Date.now();
    const steps: string[] = [];
    let totalTokens = 0;
    let turns = 0;
    const maxTurns = 10;

    console.log(`\n🤖 Agent V3 starting for user: ${input.userId}`);
    console.log(`   📸 Photos: ${input.photos.length}`);
    console.log(`   🔄 Mode: Claude Agent SDK (Autonomous)`);

    // 构建初始消息
    const initialMessage = this.buildInitialMessage(input);

    // 消息历史
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: initialMessage }
    ];

    // 存储中间结果
    let photoAnalysis: any = null;
    let memoryConnections: any[] = [];
    let iterationHistory: Array<{
      iteration: number;
      caption: string;
      photoIds: string[];
      auditScore?: number;
      strategy?: string;
    }> | undefined = undefined;  // ✅ 新增：存储5轮迭代历史

    try {
      // Agentic Loop
      while (turns < maxTurns) {
        turns++;
        console.log(`\n  ===== Turn ${turns} =====`);

        // 调用 Claude
        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          tools: CLAUDE_TOOLS,
          messages: messages
        });

        totalTokens += response.usage?.input_tokens || 0;
        totalTokens += response.usage?.output_tokens || 0;

        console.log(`  📥 Response: stop_reason=${response.stop_reason}`);

        // 检查是否需要调用工具
        if (response.stop_reason === "tool_use") {
          // 处理工具调用
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === "tool_use") {
              const toolName = block.name;
              const toolInput = block.input as any;

              console.log(`  🔧 Tool: ${toolName}`);
              steps.push(toolName);

              // 执行工具
              const result = await this.executeTool(toolName, toolInput, input.photos);

              // 保存中间结果
              if (toolName === "analyze_photos") {
                try {
                  const parsed = JSON.parse(result);
                  photoAnalysis = parsed.analysis || parsed;
                } catch {
                  photoAnalysis = { raw: result };
                }
              } else if (toolName === "retrieve_memories") {
                try {
                  const parsed = JSON.parse(result);
                  const angles = parsed.top_narrative_angles || [];
                  memoryConnections = angles.map((a: any) => ({
                    angle_type: a.angle_type,
                    memory_id: a.memory?.id || a.angle_id,
                    description: a.description,
                    confidence: a.confidence
                  }));
                } catch {
                  // ignore
                }
              } else if (toolName === "generate_story") {
                // ✅ 新增：提取 iteration_history
                try {
                  const parsed = JSON.parse(result);
                  if (parsed.iteration_history) {
                    iterationHistory = parsed.iteration_history;
                    console.log(`  ✅ 提取到 ${parsed.iteration_history.length} 轮迭代历史`);
                  }
                } catch (e) {
                  console.log(`  ⚠️ 无法解析 iteration_history: ${e}`);
                }
              }

              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result
              });
            }
          }

          // 添加 assistant 消息和工具结果
          messages.push({ role: "assistant", content: response.content });
          messages.push({ role: "user", content: toolResults });

        } else if (response.stop_reason === "end_turn") {
          // Agent 完成，提取最终输出
          console.log(`  ✅ Agent completed in ${turns} turns`);

          const textBlock = response.content.find(b => b.type === "text");
          const finalText = textBlock ? (textBlock as any).text : "";

          // 解析最终输出
          const output = this.parseAgentOutput(
            finalText,
            photoAnalysis,
            memoryConnections,
            steps,
            totalTokens,
            startTime,
            turns,
            iterationHistory  // ✅ 新增：传递5轮迭代历史
          );

          return output;
        } else {
          // 其他情况（max_tokens 等）
          console.log(`  ⚠️ Unexpected stop_reason: ${response.stop_reason}`);
          break;
        }
      }

      // 超过最大轮次
      console.log(`  ⚠️ Max turns reached (${maxTurns})`);
      return {
        status: "error",
        error: "Max turns reached without completion",
        photoAnalysis,
        memory_connections: memoryConnections,
        debug: { steps, totalTokens, totalLatencyMs: Date.now() - startTime, turns }
      };

    } catch (error) {
      console.error("Agent error:", error);
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        debug: { steps, totalTokens, totalLatencyMs: Date.now() - startTime, turns }
      };
    }
  }

  /**
   * 构建初始消息
   */
  private buildInitialMessage(input: AgentInput): string {
    const parts: string[] = [];

    parts.push(`请为我创作一个朋友圈故事。`);
    parts.push(`\n\n📸 系统已预加载 ${input.photos.length} 张照片，你可以直接调用 analyze_photos 工具进行分析（无需传入任何参数，照片数据会自动注入）。`);

    if (input.preferredStyle) {
      const styleMap: Record<string, string> = {
        natural: "自然流畅",
        literary: "文艺感",
        humorous: "幽默风趣"
      };
      parts.push(`\n偏好风格: ${styleMap[input.preferredStyle] || input.preferredStyle}`);
    }

    if (input.existingPersona) {
      parts.push(`\n用户人设: ${JSON.stringify(input.existingPersona)}`);
    }

    parts.push(`\n\n请立即调用 analyze_photos 工具开始分析这 ${input.photos.length} 张照片，无需请求额外数据。`);

    return parts.join("");
  }

  /**
   * 执行工具
   */
  private async executeTool(
    toolName: string,
    toolInput: any,
    photos: Array<{ base64: string; mimeType?: string }>
  ): Promise<string> {
    try {
      switch (toolName) {
        case "analyze_photos": {
          // 使用预加载的照片数据（忽略 toolInput.images）
          console.log(`  📷 analyze_photos: using ${photos.length} pre-loaded photos`);
          if (photos.length === 0) {
            console.error(`  ❌ No photos available!`);
            return JSON.stringify({ error: "No photos available for analysis" });
          }
          const images = photos.map(p => ({
            base64: p.base64,
            mimeType: p.mimeType || "image/jpeg"
          }));
          console.log(`  📷 Sending ${images.length} images to Gemini VLM (base64 lengths: ${images.map(i => i.base64.length).join(', ')})`);
          const result = await this.toolHandlers.analyzePhotos({
            images,
            timeRange: toolInput.timeRange || "今日"
          });
          return result.content[0].text;
        }

        case "retrieve_memories": {
          const result = await this.toolHandlers.retrieveMemories({
            photoAnalysis: toolInput.photoAnalysis || {},
            paths: toolInput.paths || ["all"],
            topK: toolInput.topK || 3,
            minConfidence: toolInput.minConfidence || 0.5
          });
          return result.content[0].text;
        }

        case "select_strategy": {
          // 策略选择逻辑
          const result = this.selectStrategy(toolInput);
          return JSON.stringify(result);
        }

        case "predict_engagement": {
          const result = await this.toolHandlers.predictEngagement({
            story: toolInput.story,
            narrativeAngle: {
              angle_type: toolInput.strategyUsed || "value_share",
              confidence: 0.8,
              description: `使用 ${toolInput.strategyUsed} 策略`
            },
            hasOldPhoto: toolInput.hasMemoryConnection || false
          });
          return result.content[0].text;
        }

        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error) {
      console.error(`Tool ${toolName} error:`, error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed"
      });
    }
  }

  /**
   * 选择叙事策略 - ReAct Step 4
   */
  private selectStrategy(input: {
    photoFeatures: {
      hasBrand?: boolean;
      hasAchievement?: boolean;
      hasRareExperience?: boolean;
      emotionStrength?: number;
      locationType?: string;
      hasUsefulInfo?: boolean;
    };
    memoryMatch?: {
      found?: boolean;
      confidence?: number;
      angleType?: string;
      timeGapDays?: number;
      emotionContrast?: boolean;
    };
  }): {
    recommended_strategy: string;
    strategy_scores: Record<string, number>;
    reasoning: string;
    template: {
      structure: string;
      example: string;
      key_elements: string[];
    };
  } {
    const features = input.photoFeatures || {};
    const memory = input.memoryMatch || {};

    // 计算每个策略的适用性评分
    const scores: Record<string, number> = {
      time_contrast: 0,
      subtle_flex: 0,
      emotion_capture: 0,
      value_share: 0
    };

    // A. 时间对比型：需要高置信度记忆 + 情感反差
    if (memory.found && (memory.confidence || 0) >= 0.75) {
      scores.time_contrast += 4;
      if (memory.emotionContrast) scores.time_contrast += 3;
      if ((memory.timeGapDays || 0) >= 30) scores.time_contrast += 2;
    }

    // B. 隐形炫耀型：需要品牌/成就/稀缺体验
    if (features.hasBrand) scores.subtle_flex += 3;
    if (features.hasAchievement) scores.subtle_flex += 4;
    if (features.hasRareExperience) scores.subtle_flex += 3;

    // C. 情绪捕捉型：需要明确情绪表达
    const emotionStrength = features.emotionStrength || 0;
    if (emotionStrength >= 7) scores.emotion_capture += 5;
    else if (emotionStrength >= 5) scores.emotion_capture += 3;

    // D. 信息分享型：需要实用信息
    if (features.hasUsefulInfo) scores.value_share += 4;
    if (features.locationType === "餐厅" || features.locationType === "旅行") {
      scores.value_share += 2;
    }

    // 找出最高分策略
    const maxScore = Math.max(...Object.values(scores));
    const recommended = Object.entries(scores).find(([, score]) => score === maxScore)?.[0] || "value_share";

    // 策略模板
    const templates: Record<string, { structure: string; example: string; key_elements: string[] }> = {
      time_contrast: {
        structure: "X个月前...，而现在...",
        example: "半年前，她还在为租房发愁，签约那天握着钥匙的手都在抖。现在站在新装修好的家里，才发现当时那些焦虑，都成了回忆里最甜的部分。",
        key_elements: ["时间锚点", "今昔对比", "情感变化", "感悟升华"]
      },
      subtle_flex: {
        structure: "轻描淡写 + 不经意展示",
        example: "她又把那个限量版包忘在咖啡厅了，第三次了。老板娘已经认识她了，每次都帮她收好，还会多送一块蛋糕。",
        key_elements: ["品牌/成就", "不直接点破", "侧面展示", "轻松语气"]
      },
      emotion_capture: {
        structure: "细节描写 + 情绪留白",
        example: "她盯着那杯已经凉透的拿铁，冰块早就化完了。服务员走过来问要不要换一杯，她摇摇头，说'这杯刚刚好'。",
        key_elements: ["具体动作", "环境细节", "情绪暗示", "留白结尾"]
      },
      value_share: {
        structure: "发现 + 体验 + 感受",
        example: "巷子深处的那家小店，招牌都快掉了。她本来没抱希望，结果一口下去直接愣住——这是吃过最好吃的牛肉面，没有之一。",
        key_elements: ["探索过程", "真实体验", "主观评价", "推荐意愿"]
      }
    };

    // 生成推理说明
    let reasoning = "";
    if (recommended === "time_contrast") {
      reasoning = `检测到高置信度记忆匹配(${((memory.confidence || 0) * 100).toFixed(0)}%)，${memory.emotionContrast ? "且存在情感反差" : ""}，适合时间对比叙事。`;
    } else if (recommended === "subtle_flex") {
      const flexPoints = [];
      if (features.hasBrand) flexPoints.push("品牌物品");
      if (features.hasAchievement) flexPoints.push("成就展示");
      if (features.hasRareExperience) flexPoints.push("稀缺体验");
      reasoning = `照片包含${flexPoints.join("、")}，适合隐形炫耀叙事。`;
    } else if (recommended === "emotion_capture") {
      reasoning = `检测到情绪强度${emotionStrength}/10，适合情绪捕捉叙事。`;
    } else {
      reasoning = `照片包含实用信息或探店内容，适合信息分享叙事。`;
    }

    return {
      recommended_strategy: recommended,
      strategy_scores: scores,
      reasoning,
      template: templates[recommended]
    };
  }

  /**
   * 解析 Agent 输出
   */
  private parseAgentOutput(
    finalText: string,
    photoAnalysis: any,
    memoryConnections: any[],
    steps: string[],
    totalTokens: number,
    startTime: number,
    turns: number,
    iterationHistory?: Array<{  // ✅ 新增：接收5轮迭代历史
      iteration: number;
      caption: string;
      photoIds: string[];
      auditScore?: number;
      strategy?: string;
    }>
  ): AgentOutput {
    const debug = {
      steps,
      totalTokens,
      totalLatencyMs: Date.now() - startTime,
      turns
    };

    // 尝试解析 JSON
    try {
      // 提取 JSON
      const jsonMatch = finalText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        return {
          status: parsed.status || "success",
          story: parsed.story,
          discovery_angle: parsed.discovery_angle,
          reasoning: parsed.reasoning,
          engagement_score: parsed.engagement_score,
          viral_breakdown: parsed.viral_breakdown,
          likely_reactions: parsed.likely_reactions,
          photoAnalysis,
          memory_connections: memoryConnections,
          iteration_history: iterationHistory,  // ✅ 新增：传递5轮迭代历史
          debug
        };
      }
    } catch (e) {
      console.log(`  ⚠️ Failed to parse final output as JSON: ${e}`);
    }

    // 解析失败，返回原始文本作为故事
    return {
      status: "success",
      story: {
        title: "今日分享",
        body: finalText.substring(0, 200)
      },
      discovery_angle: "分享价值",
      photoAnalysis,
      memory_connections: memoryConnections,
      iteration_history: iterationHistory,  // ✅ 新增：传递5轮迭代历史
      debug
    };
  }
}
