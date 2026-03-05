/**
 * Memory Trace Agent - 记忆溯源分析 Agent
 *
 * 架构：Gemini VLM 预分析 + Claude 编排 + Claude 叙事生成
 * - Gemini 2.0 Flash 处理图片视觉分析（省 Claude Vision token）
 * - Claude 驱动 agentic loop：编排工具调用 + 生成叙事
 * - SSE 实时推送执行步骤
 *
 * 工具链：get_persona → analyze_photo_objects(Gemini) → search_memory_matches → generate_trace_narratives
 */

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ToolHandlers } from "../../tools";
import { personaSummaryService } from "../../services/persona-summary.service";
import {
  AgentStepEvent,
  MemoryTraceInput,
  MemoryTraceOutput,
  PhotoTraceOutput,
  TraceAnchorResult
} from "./types";
import {
  MEMORY_TRACE_SYSTEM_PROMPT,
  getMemoryTraceTools,
  getMemoryTraceToolMessages,
  buildMemoryTraceUserMessage
} from "./memory-trace-prompt";
import { memoryTracePromptConfigManager } from "./memory-trace-prompt-config";

export class MemoryTraceAgent {
  private client: Anthropic;
  private geminiModel: any;  // Gemini GenerativeModel
  private toolHandlers: ToolHandlers;
  private photos: Array<{ base64: string; mimeType?: string; localIdentifier?: string }> = [];

  constructor() {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.client = new Anthropic({ apiKey: anthropicKey });

    // Gemini VLM for photo pre-analysis
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      throw new Error("GEMINI_API_KEY is required for Memory Trace VLM");
    }
    const genAI = new GoogleGenerativeAI(geminiKey);
    this.geminiModel = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 4096
      }
    });

    this.toolHandlers = new ToolHandlers();
    console.log("✅ Memory Trace Agent initialized (Gemini VLM + Claude orchestration)");
  }

  /**
   * 运行 Memory Trace 分析
   */
  async run(
    input: MemoryTraceInput,
    onStep?: (event: AgentStepEvent) => void
  ): Promise<MemoryTraceOutput> {
    const TIMEOUT_MS = 120000; // 120秒超时（分析多张照片比较耗时）

    const timeoutPromise = new Promise<MemoryTraceOutput>((_, reject) => {
      setTimeout(() => reject(new Error('Memory Trace timeout after 120s')), TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.runInternal(input, onStep),
        timeoutPromise
      ]);
    } catch (error: any) {
      console.error(`❌ Memory Trace error: ${error.message}`);
      return {
        status: "error",
        photoResults: [],
        error: error.message,
        debug: {
          agentSteps: [],
          totalTokens: 0,
          totalLatencyMs: TIMEOUT_MS,
          agentTurns: 0
        }
      };
    }
  }

  /**
   * 内部执行逻辑 - agentic loop
   */
  private async runInternal(
    input: MemoryTraceInput,
    onStep?: (event: AgentStepEvent) => void
  ): Promise<MemoryTraceOutput> {
    const startTime = Date.now();
    const steps: string[] = [];
    let totalTokens = 0;
    let turns = 0;
    let stepCounter = 0;
    const maxTurns = 8;

    console.log(`\n🔬 Memory Trace starting for user: ${input.userId}`);
    console.log(`   📸 Photos: ${input.photos.length}`);

    onStep?.({
      type: 'agent_start',
      step: ++stepCounter,
      message: `🔬 开始分析 ${input.photos.length} 张照片的记忆锚点...`,
      timestamp: Date.now()
    });

    // 保存照片供工具使用
    this.photos = input.photos;

    // 中间结果
    let personaContext = '';
    let photoObjects: any = null;
    let memoryMatches: any = null;
    let traceResults: PhotoTraceOutput[] = [];

    const stepDetails: any[] = [];

    // ==================== Step 0: Gemini VLM 预分析 ====================
    // 用 Gemini 看图，生成结构化文本描述，Claude 不再直接看图
    let vlmPreAnalysis = '';
    try {
      const vlmStart = Date.now();
      onStep?.({
        type: 'tool_start',
        step: ++stepCounter,
        tool: 'gemini_vlm_preanalysis',
        message: '🔍 Gemini 正在分析照片视觉内容...',
        timestamp: Date.now(),
        turn: 0
      });

      vlmPreAnalysis = await this.geminiPreAnalyze(input.photos);
      this.vlmPreAnalysisCache = vlmPreAnalysis;  // 缓存供 analyze_photo_objects 工具使用
      const vlmTime = Date.now() - vlmStart;

      steps.push('gemini_vlm_preanalysis');
      onStep?.({
        type: 'tool_done',
        step: ++stepCounter,
        tool: 'gemini_vlm_preanalysis',
        message: `✅ 视觉预分析完成 (${vlmTime}ms)`,
        timestamp: Date.now(),
        turn: 0,
        durationMs: vlmTime
      });

      console.log(`  ✅ Gemini VLM pre-analysis done in ${vlmTime}ms`);
    } catch (err: any) {
      console.error(`  ❌ Gemini VLM pre-analysis failed:`, err.message);
      vlmPreAnalysis = `[VLM 预分析失败，请根据照片ID和已有工具进行分析] 共 ${input.photos.length} 张照片`;
    }

    // ==================== 构建 Claude 消息（纯文本，无图片） ====================
    const photoIdList = input.photos.map((p, i) =>
      `照片 ${i + 1}: ID=${p.localIdentifier || `photo_${i}`}`
    ).join('\n');

    const userMessage = `${memoryTracePromptConfigManager.renderUserMessage({
      photoCount: input.photos.length,
      hasPersona: !!input.personaSummary
    })}

## Gemini VLM 视觉预分析结果
${vlmPreAnalysis}

## 照片列表
${photoIdList}`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: userMessage }
    ];

    try {
      while (turns < maxTurns) {
        turns++;
        const llmStart = Date.now();

        const mtConfig = memoryTracePromptConfigManager.getConfig();
        const response = await this.client.messages.create({
          model: mtConfig.modelConfig?.model || "claude-sonnet-4-20250514",
          max_tokens: mtConfig.modelConfig?.maxTokens || 4096,
          system: memoryTracePromptConfigManager.getSystemPrompt(),
          tools: memoryTracePromptConfigManager.getTools(),
          messages
        });

        const llmTime = Date.now() - llmStart;
        totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

        if (response.stop_reason === "tool_use") {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          const toolMessages = memoryTracePromptConfigManager.getToolProgressMessages();

          for (const block of response.content) {
            if (block.type === "tool_use") {
              const toolName = block.name;
              const toolInput = block.input as any;
              const toolStart = Date.now();

              console.log(`  🔧 ${toolName}...`);
              steps.push(toolName);

              onStep?.({
                type: 'tool_start',
                step: ++stepCounter,
                tool: toolName,
                message: toolMessages[toolName] || `🔧 执行 ${toolName}...`,
                timestamp: Date.now(),
                turn: turns
              });

              // 执行工具
              const result = await this.executeTool(
                toolName,
                toolInput,
                photoObjects,
                memoryMatches,
                personaContext,
                input.userId
              );
              const toolTime = Date.now() - toolStart;

              // 保存中间结果
              if (toolName === "get_persona") {
                try {
                  const parsed = JSON.parse(result);
                  personaContext = parsed.persona || '';
                } catch { personaContext = result; }

                onStep?.({
                  type: 'tool_done',
                  step: ++stepCounter,
                  tool: toolName,
                  message: '✅ 用户画像已加载',
                  timestamp: Date.now(),
                  turn: turns,
                  durationMs: toolTime
                });

              } else if (toolName === "analyze_photo_objects") {
                try { photoObjects = JSON.parse(result); } catch { photoObjects = { raw: result }; }

                onStep?.({
                  type: 'tool_done',
                  step: ++stepCounter,
                  tool: toolName,
                  message: '✅ 照片元素识别完成',
                  timestamp: Date.now(),
                  turn: turns,
                  durationMs: toolTime
                });

              } else if (toolName === "search_memory_matches") {
                try { memoryMatches = JSON.parse(result); } catch { memoryMatches = { raw: result }; }

                const matchCount = memoryMatches?.matches?.length || 0;
                onStep?.({
                  type: 'tool_done',
                  step: ++stepCounter,
                  tool: toolName,
                  message: `✅ 找到 ${matchCount} 条跨时间关联`,
                  timestamp: Date.now(),
                  turn: turns,
                  durationMs: toolTime
                });

              } else if (toolName === "generate_trace_narratives") {
                try {
                  const parsed = JSON.parse(result);
                  traceResults = this.parseTraceResults(parsed, input.photos);
                } catch {
                  traceResults = [];
                }

                const anchorCount = traceResults.reduce((sum, r) => sum + r.anchors.length, 0);
                onStep?.({
                  type: 'tool_done',
                  step: ++stepCounter,
                  tool: toolName,
                  message: `✅ 生成 ${anchorCount} 个溯源叙事`,
                  timestamp: Date.now(),
                  turn: turns,
                  durationMs: toolTime
                });
              }

              stepDetails.push({
                turn: turns,
                tool: toolName,
                startTime: toolStart,
                durationMs: toolTime,
                inputTokens: response.usage?.input_tokens || 0,
                outputTokens: response.usage?.output_tokens || 0,
                input: toolInput,
                output: result.substring(0, 500)
              });

              toolResults.push({
                type: "tool_result",
                tool_use_id: block.id,
                content: result
              });
            }
          }

          messages.push({ role: "assistant", content: response.content });
          messages.push({ role: "user", content: toolResults });

        } else if (response.stop_reason === "end_turn") {
          console.log(`  ✅ Memory Trace completed in ${turns} turns`);

          onStep?.({
            type: 'agent_complete',
            step: ++stepCounter,
            message: `🎉 记忆溯源分析完成！`,
            timestamp: Date.now(),
            turn: turns,
            durationMs: Date.now() - startTime
          });

          return {
            status: "success",
            photoResults: traceResults,
            debug: {
              agentSteps: steps,
              stepDetails,
              totalTokens,
              totalLatencyMs: Date.now() - startTime,
              agentTurns: turns
            }
          };
        } else {
          break;
        }
      }

      // 超过最大轮次 — 仍然返回已有结果
      return {
        status: traceResults.length > 0 ? "success" : "error",
        photoResults: traceResults,
        error: traceResults.length === 0 ? "Max turns reached" : undefined,
        debug: {
          agentSteps: steps,
          stepDetails,
          totalTokens,
          totalLatencyMs: Date.now() - startTime,
          agentTurns: turns
        }
      };

    } catch (error: any) {
      console.error(`❌ Memory Trace loop error:`, error);
      return {
        status: "error",
        photoResults: traceResults,
        error: error.message,
        debug: {
          agentSteps: steps,
          stepDetails,
          totalTokens,
          totalLatencyMs: Date.now() - startTime,
          agentTurns: turns
        }
      };
    }
  }

  // ==================== Tool Execution ====================

  private vlmPreAnalysisCache: string = '';  // 缓存 Gemini 预分析结果

  private async executeTool(
    toolName: string,
    toolInput: any,
    photoObjects: any,
    memoryMatches: any,
    personaContext: string,
    userId: string
  ): Promise<string> {
    try {
      switch (toolName) {
        case "get_persona": {
          const persona = await personaSummaryService.getPersonaContext(userId);
          return JSON.stringify({ success: true, persona });
        }

        case "analyze_photo_objects": {
          // 直接返回 Gemini VLM 预分析结果（Step 0 已完成）
          // 不再重复调用 Gemini，节省时间和 token
          if (this.vlmPreAnalysisCache) {
            return this.vlmPreAnalysisCache;
          }
          // Fallback: 如果预分析缓存为空，调用 Gemini
          if (this.photos.length === 0) {
            return JSON.stringify({ error: "No photos" });
          }
          const preResult = await this.geminiPreAnalyze(this.photos);
          return preResult;
        }

        case "search_memory_matches": {
          // 复用 retrieveMemories 进行跨时间记忆搜索
          const candidates = toolInput.candidates || [];
          const queryTerms = candidates
            .map((c: any) => `${c.label} ${c.category || ''}`)
            .join(' ')
            .trim();

          const result = await this.toolHandlers.retrieveMemories({
            photoAnalysis: {
              entities: candidates.map((c: any) => c.label),
              activities: [],
              emotion: '',
              people: candidates.filter((c: any) => c.category === 'person').map((c: any) => c.label),
              location: candidates.find((c: any) => c.category === 'place')?.label
            },
            paths: ["all"],
            topK: 5,
            minConfidence: 0.4
          }, userId);

          return result.content[0].text;
        }

        case "generate_trace_narratives": {
          // Agent 自己生成叙事脚本 — 通过 Claude 直接生成
          const anchors = toolInput.anchors || [];

          if (anchors.length === 0) {
            return JSON.stringify({
              success: true,
              photoResults: this.photos.map((p, i) => ({
                photoAssetId: p.localIdentifier || `photo_${i}`,
                anchors: [],
                status: 'no_anchors'
              }))
            });
          }

          const narrativePrompt = this.buildNarrativePrompt(anchors, personaContext);
          const response = await this.client.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 2048,
            messages: [{ role: "user", content: narrativePrompt }]
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";

          // 尝试解析 JSON
          try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              return jsonMatch[0];
            }
          } catch {}

          return JSON.stringify({
            success: true,
            photoResults: this.photos.map((p, i) => ({
              photoAssetId: p.localIdentifier || `photo_${i}`,
              anchors: [],
              status: 'no_anchors'
            }))
          });
        }

        default:
          return JSON.stringify({ error: `Unknown tool: ${toolName}` });
      }
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed"
      });
    }
  }

  // ==================== Gemini VLM Pre-Analysis ====================

  /**
   * 用 Gemini 2.0 Flash 预分析所有照片
   * 返回结构化 JSON 文本描述，供 Claude 编排使用
   */
  private async geminiPreAnalyze(
    photos: Array<{ base64: string; mimeType?: string; localIdentifier?: string; creationDate?: string }>
  ): Promise<string> {
    // 构建 Gemini 请求：text prompt + inline images
    const imageParts = photos.map((photo, i) => ({
      inlineData: {
        data: photo.base64,
        mimeType: photo.mimeType || "image/jpeg"
      }
    }));

    // 构建照片时间线元数据
    const photoTimeline = photos.map((p, i) => {
      const dateStr = p.creationDate
        ? new Date(p.creationDate).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '未知时间';
      return `  照片${i}: ${dateStr} (${p.localIdentifier || 'photo_' + i})`;
    }).join('\n');

    const prompt = `分析以下 ${photos.length} 张照片，为每张照片识别有"故事价值"的物体、场景和人物。

## 照片时间线（按拍摄时间排序）
${photoTimeline}

请注意照片之间的**时间关系**，这有助于发现时间变化和成长线索。

## 故事价值标准
- **情感锚点**：承载特殊情感的物品（礼物、纪念品、宠物用品）
- **关系见证**：人物互动中的标志物（合影地点、共同爱好相关物品）
- **时间印记**：体现变化和成长的元素（服装风格变化、发型变化）
- **生活方式**：反映个性和习惯的特征（常见的咖啡品牌、运动装备）

## 对每张照片输出
- **photoIndex**: 照片序号（从0开始）
- **photoId**: "${photos[0]?.localIdentifier || 'photo_0'}" 等
- **scene**: 场景描述
- **objects**: 有故事价值的物体列表，每个包含：
  - label: 物体名称（具体，如"蓝色碎花连衣裙"而非"衣服"）
  - category: person / object / place / pet / food
  - centerX, centerY: 归一化坐标 (0-1)，物体在照片中的位置
  - bboxX, bboxY, bboxWidth, bboxHeight: 归一化边界框
  - storyPotential: 故事潜力评分 0-1
  - reason: 为什么这个物体有故事价值（一句话）
- **people**: 人物描述（外貌特征、互动、推测关系）
- **emotion**: 照片传达的情绪

每张照片最多 3 个有故事价值的物体。没有故事价值的照片 objects 为空数组。

直接输出 JSON（不要 markdown 代码块）：
{
  "photos": [
    {
      "photoIndex": 0,
      "photoId": "照片ID",
      "scene": "咖啡店",
      "objects": [
        {
          "label": "星巴克限定圣诞杯",
          "category": "object",
          "centerX": 0.4,
          "centerY": 0.6,
          "bboxX": 0.3,
          "bboxY": 0.5,
          "bboxWidth": 0.2,
          "bboxHeight": 0.2,
          "storyPotential": 0.8,
          "reason": "限定款可能代表特定时期的回忆"
        }
      ],
      "people": "一位短发女性在拍自拍",
      "emotion": "轻松愉快"
    }
  ]
}`;

    const result = await this.geminiModel.generateContent([
      { text: prompt },
      ...imageParts
    ]);

    const text = result.response.text();
    console.log(`  📝 Gemini VLM output length: ${text.length} chars`);

    return text;
  }

  // ==================== Helper Methods ====================

  private buildNarrativePrompt(anchors: any[], personaContext: string): string {
    const anchorDescriptions = anchors.map((a: any, i: number) => {
      return `锚点 ${i + 1}: "${a.label}" 位于 (${a.centerX?.toFixed(2)}, ${a.centerY?.toFixed(2)})
  记忆上下文: ${a.memoryContext || '无'}
  情感变化: ${a.emotionShift || '无'}`;
    }).join('\n\n');

    return `你是记忆溯源叙事生成器。为每个锚点生成简短、有温度的溯源叙事。

${personaContext ? `## 用户画像\n${personaContext}\n` : ''}

## 锚点信息
${anchorDescriptions}

## 要求
- 每个锚点生成一个 narrativeTitle（5-10字标题）和 narrativeScript（30-60字叙事）
- 第三人称（她/他），要有时间跨度感
- emotionTone 从以下选择: nostalgic, warm, bittersweet, proud, playful, grateful

直接输出 JSON（不要 markdown 代码块）：
{
  "success": true,
  "photoResults": [
    {
      "photoAssetId": "照片ID",
      "anchors": [
        {
          "id": "anchor_唯一ID",
          "label": "物体标签",
          "centerX": 0.5,
          "centerY": 0.3,
          "bbox": { "x": 0.3, "y": 0.1, "width": 0.4, "height": 0.4 },
          "confidence": 0.85,
          "narrativeTitle": "标题",
          "narrativeScript": "30-60字溯源叙事",
          "emotionTone": "warm"
        }
      ],
      "status": "completed"
    }
  ]
}`;
  }

  private parseTraceResults(parsed: any, photos: Array<{ localIdentifier?: string }>): PhotoTraceOutput[] {
    if (parsed.photoResults && Array.isArray(parsed.photoResults)) {
      return parsed.photoResults.map((pr: any, idx: number) => ({
        // Claude may return fabricated IDs like "photo_001" — map back to real localIdentifier
        photoAssetId: photos[idx]?.localIdentifier || pr.photoAssetId || '',
        anchors: (pr.anchors || []).map((a: any) => ({
          id: a.id || `anchor_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          label: a.label || '',
          centerX: a.centerX ?? 0.5,
          centerY: a.centerY ?? 0.5,
          bbox: a.bbox || { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
          confidence: a.confidence ?? 0.7,
          matchedPhotoAssetId: a.matchedPhotoAssetId,
          matchSimilarity: a.matchSimilarity,
          matchedLabel: a.matchedLabel,
          narrativeTitle: a.narrativeTitle,
          narrativeScript: a.narrativeScript,
          emotionTone: a.emotionTone
        })),
        status: pr.status || 'completed'
      }));
    }

    // Fallback: 没有匹配到结果
    return photos.map((p, i) => ({
      photoAssetId: p.localIdentifier || `photo_${i}`,
      anchors: [],
      status: 'no_anchors' as const
    }));
  }
}
