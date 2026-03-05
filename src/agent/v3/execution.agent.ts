/**
 * Execution Agent - 执行层
 * 负责执行具体任务，不与用户直接交互
 */

import Anthropic from "@anthropic-ai/sdk";
import { ToolHandlers } from "../../tools";
import {
  Task,
  TaskResult,
  Story,
  SubagentTask,
  SubagentResult,
  ViralBreakdown
} from "./types";

// 执行层 System Prompt
const EXECUTION_SYSTEM_PROMPT = `你是 Pixel Beat 的执行引擎。你的任务是完成 Pixel Beat 分配的具体任务，并将结果返回给它。

你不直接与用户交互。你的输出会被 Pixel Beat 处理后呈现给用户。

## 职责
1. **执行任务** - 调用工具完成分配的任务
2. **并行加速** - 可并行的任务同时执行
3. **结构化返回** - 返回包含 ID 的结构化结果
4. **专注执行** - 不做用户交互，不添加对话性语言

## 可用工具
1. analyze_photos - VLM 图片分析
2. retrieve_memories - 4-Path 记忆检索
3. generate_story - 故事生成
4. predict_engagement - 5维评分 + 互动预测
5. transform_style - 风格转换

## 输出格式
{
  "task_id": "task_xxx",
  "status": "success" | "error" | "partial",
  "results": { ... },
  "recommended": "推荐的选项ID",
  "reasoning": "推荐理由",
  "execution_time_ms": 3500
}

## 禁止事项
- 不要与用户直接对话
- 不要添加"让我来帮你..."等对话性语言
- 不要解释你的工具调用过程
- 不要猜测信息，找不到就如实返回
- 不要在结果中包含情感化表达`;

// Claude 工具定义
const EXECUTION_TOOLS: Anthropic.Tool[] = [
  {
    name: "analyze_photos",
    description: "分析照片内容，提取场景、人物、情绪、故事潜力。照片数据已预加载。",
    input_schema: {
      type: "object" as const,
      properties: {
        focus: {
          type: "string",
          enum: ["general", "emotion", "social", "activity", "environment"],
          description: "分析重点"
        }
      },
      required: []
    }
  },
  {
    name: "retrieve_memories",
    description: "4-Path 海马体检索，找到相关历史记忆。",
    input_schema: {
      type: "object" as const,
      properties: {
        photoAnalysis: {
          type: "object",
          description: "当前照片分析结果"
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "检索路径: entity, emotion_echo, emotion_contrast, location, person"
        },
        topK: {
          type: "number",
          description: "每条路径返回数量"
        }
      },
      required: ["photoAnalysis"]
    }
  },
  {
    name: "generate_story",
    description: "基于分析和记忆生成故事文案。",
    input_schema: {
      type: "object" as const,
      properties: {
        analysis: {
          type: "object",
          description: "照片分析结果"
        },
        memories: {
          type: "array",
          description: "相关记忆"
        },
        angle: {
          type: "string",
          enum: ["hidden_flex", "emotion_peak", "share_value", "time_contrast"],
          description: "叙事角度"
        },
        style: {
          type: "string",
          enum: ["natural", "literary", "humorous", "gossip", "warm", "mysterious"],
          description: "故事风格"
        }
      },
      required: ["analysis", "angle"]
    }
  },
  {
    name: "predict_engagement",
    description: "5维流量评分 + 互动预测。",
    input_schema: {
      type: "object" as const,
      properties: {
        story: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" },
            style: { type: "string" }
          },
          required: ["title", "body"]
        },
        hasMemoryConnection: {
          type: "boolean",
          description: "是否使用了历史记忆"
        }
      },
      required: ["story"]
    }
  },
  {
    name: "transform_style",
    description: "将故事转换为不同风格。",
    input_schema: {
      type: "object" as const,
      properties: {
        story: {
          type: "object",
          properties: {
            title: { type: "string" },
            body: { type: "string" }
          },
          required: ["title", "body"]
        },
        targetStyle: {
          type: "string",
          enum: ["natural", "literary", "humorous", "gossip", "warm", "mysterious"]
        }
      },
      required: ["story", "targetStyle"]
    }
  }
];

/**
 * Execution Agent 类 - 执行层
 */
export class ExecutionAgent {
  private anthropic: Anthropic;
  private toolHandlers: ToolHandlers;
  private storyCache: Map<string, Story> = new Map();
  private taskCounter: number = 0;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.toolHandlers = new ToolHandlers();
    console.log("✅ Execution Agent initialized");
  }

  /**
   * 执行任务 - 核心方法
   */
  async execute(task: Task, photos: Array<{ base64: string; mimeType?: string }>): Promise<TaskResult> {
    const startTime = Date.now();
    const steps: string[] = [];
    let totalTokens = 0;
    let turns = 0;
    const maxTurns = 8;

    console.log(`\n⚙️ Execution Agent: Task ${task.id}`);
    console.log(`   Goal: ${task.goal}`);

    // 构建执行消息
    const initialMessage = this.buildExecutionMessage(task);

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: initialMessage }
    ];

    // 存储中间结果
    let photoAnalysis: any = null;
    let memories: any[] = [];
    let generatedStories: Story[] = [];

    try {
      while (turns < maxTurns) {
        turns++;

        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          system: EXECUTION_SYSTEM_PROMPT,
          tools: EXECUTION_TOOLS,
          messages
        });

        totalTokens += response.usage?.input_tokens || 0;
        totalTokens += response.usage?.output_tokens || 0;

        if (response.stop_reason === "tool_use") {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const block of response.content) {
            if (block.type === "tool_use") {
              const toolName = block.name;
              const toolInput = block.input as any;

              console.log(`   🔧 ${toolName}`);
              steps.push(toolName);

              const result = await this.executeTool(toolName, toolInput, photos, photoAnalysis, memories);

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
                  memories = parsed.top_narrative_angles || [];
                } catch {
                  // ignore
                }
              } else if (toolName === "generate_story") {
                try {
                  const parsed = JSON.parse(result);
                  if (parsed.story) {
                    const story: Story = {
                      id: `story_${Date.now()}_${generatedStories.length}`,
                      title: parsed.story.title,
                      body: parsed.story.body,
                      angle: toolInput.angle || 'share_value',
                      style: toolInput.style || 'natural',
                      createdAt: Date.now()
                    };
                    generatedStories.push(story);
                    this.storyCache.set(story.id, story);
                  }
                } catch {
                  // ignore
                }
              } else if (toolName === "predict_engagement") {
                try {
                  const parsed = JSON.parse(result);
                  // 更新最后一个故事的分数
                  if (generatedStories.length > 0 && parsed.viral_score) {
                    const lastStory = generatedStories[generatedStories.length - 1];
                    lastStory.score = parsed.viral_score.total;
                    lastStory.viralBreakdown = {
                      gossip: parsed.viral_score.breakdown.gossip_score,
                      hotness: parsed.viral_score.breakdown.hotness_score,
                      status: parsed.viral_score.breakdown.status_score,
                      class: parsed.viral_score.breakdown.class_score,
                      memoryDepth: parsed.viral_score.breakdown.memory_depth_score
                    };
                  }
                } catch {
                  // ignore
                }
              }

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
          console.log(`   ✅ Completed in ${turns} turns`);

          // 解析最终输出
          const textBlock = response.content.find(b => b.type === "text");
          const finalText = textBlock ? (textBlock as any).text : "";

          return this.buildTaskResult(
            task.id,
            finalText,
            photoAnalysis,
            memories,
            generatedStories,
            steps,
            startTime
          );
        } else {
          break;
        }
      }

      // 超过最大轮次
      return {
        taskId: task.id,
        status: "error",
        results: { error: "Max turns reached" },
        executionTimeMs: Date.now() - startTime
      };

    } catch (error) {
      console.error("Execution error:", error);
      return {
        taskId: task.id,
        status: "error",
        results: { error: error instanceof Error ? error.message : "Unknown error" },
        executionTimeMs: Date.now() - startTime
      };
    }
  }

  /**
   * 并行执行多个子任务
   */
  async executeParallel(
    subTasks: SubagentTask[],
    photos: Array<{ base64: string; mimeType?: string }>
  ): Promise<SubagentResult[]> {
    console.log(`\n⚡ Parallel execution: ${subTasks.length} subtasks`);

    const promises = subTasks.map(async (subTask) => {
      const startTime = Date.now();
      try {
        const task: Task = {
          id: subTask.id,
          goal: subTask.goal,
          context: {},
          priority: 'normal',
          status: 'running',
          createdAt: Date.now()
        };

        const result = await this.execute(task, photos);

        return {
          subagentId: subTask.id,
          status: 'success' as const,
          result: result.results,
          executionTimeMs: Date.now() - startTime
        };
      } catch (error) {
        return {
          subagentId: subTask.id,
          status: 'error' as const,
          result: { error: error instanceof Error ? error.message : "Unknown error" },
          executionTimeMs: Date.now() - startTime
        };
      }
    });

    return Promise.all(promises);
  }

  /**
   * 获取缓存的故事
   */
  getStory(storyId: string): Story | undefined {
    return this.storyCache.get(storyId);
  }

  /**
   * 构建执行消息
   */
  private buildExecutionMessage(task: Task): string {
    const parts: string[] = [];

    parts.push(`## 任务目标\n${task.goal}`);

    if (task.context && Object.keys(task.context).length > 0) {
      parts.push(`\n## 上下文\n${JSON.stringify(task.context, null, 2)}`);
    }

    parts.push(`\n## 要求\n- 高效完成任务\n- 返回结构化结果\n- 不要添加对话性语言`);

    return parts.join("\n");
  }

  /**
   * 执行工具
   */
  private async executeTool(
    toolName: string,
    toolInput: any,
    photos: Array<{ base64: string; mimeType?: string }>,
    photoAnalysis: any,
    memories: any[]
  ): Promise<string> {
    try {
      switch (toolName) {
        case "analyze_photos": {
          if (photos.length === 0) {
            return JSON.stringify({ error: "No photos available" });
          }
          const images = photos.map(p => ({
            base64: p.base64,
            mimeType: p.mimeType || "image/jpeg"
          }));
          const result = await this.toolHandlers.analyzePhotos({
            images,
            timeRange: "今日"
          });
          return result.content[0].text;
        }

        case "retrieve_memories": {
          const result = await this.toolHandlers.retrieveMemories({
            photoAnalysis: toolInput.photoAnalysis || photoAnalysis || {},
            paths: toolInput.paths || ["all"],
            topK: toolInput.topK || 3,
            minConfidence: 0.5
          });
          return result.content[0].text;
        }

        case "generate_story": {
          // 使用 AI 生成故事
          const storyPrompt = this.buildStoryPrompt(
            toolInput.analysis || photoAnalysis,
            toolInput.memories || memories,
            toolInput.angle,
            toolInput.style
          );

          const response = await this.anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1024,
            messages: [{ role: "user", content: storyPrompt }]
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";

          // 解析故事
          try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              return JSON.stringify({ success: true, story: JSON.parse(jsonMatch[0]) });
            }
          } catch {
            // ignore
          }

          return JSON.stringify({
            success: true,
            story: {
              title: "今日分享",
              body: text.substring(0, 150)
            }
          });
        }

        case "predict_engagement": {
          const result = await this.toolHandlers.predictEngagement({
            story: toolInput.story,
            narrativeAngle: {
              angle_type: "default",
              confidence: 0.8,
              description: "故事评估"
            },
            hasOldPhoto: toolInput.hasMemoryConnection || false
          });
          return result.content[0].text;
        }

        case "transform_style": {
          const transformPrompt = `将以下故事转换为${toolInput.targetStyle}风格：

原故事：
标题：${toolInput.story.title}
正文：${toolInput.story.body}

要求：
- 保持核心信息不变
- 调整语气和表达方式
- 字数控制在 80-150 字

直接输出 JSON：{"title": "...", "body": "..."}`;

          const response = await this.anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 512,
            messages: [{ role: "user", content: transformPrompt }]
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          return JSON.stringify({ success: true, story: JSON.parse(text) });
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

  /**
   * 构建故事生成 Prompt
   */
  private buildStoryPrompt(
    analysis: any,
    memories: any[],
    angle: string,
    style: string
  ): string {
    const angleDescriptions: Record<string, string> = {
      hidden_flex: "隐形炫耀 - 不经意间展示成就或品质",
      emotion_peak: "情绪捕捉 - 捕捉情感高点，细节描写",
      share_value: "分享价值 - 有用信息或体验分享",
      time_contrast: "时间对比 - 今昔对比，变化与成长"
    };

    const styleDescriptions: Record<string, string> = {
      natural: "自然流畅，像朋友聊天",
      literary: "文学质感，富有意象",
      humorous: "轻松幽默，自嘲调侃",
      gossip: "八卦口吻，制造悬念",
      warm: "温暖治愈，情感饱满",
      mysterious: "神秘感，引发好奇"
    };

    return `你是一位 AI 狗仔队，以第三人称视角报道用户生活。

## 照片分析
${JSON.stringify(analysis, null, 2)}

${memories.length > 0 ? `## 相关记忆\n${JSON.stringify(memories, null, 2)}` : ""}

## 叙事角度
${angleDescriptions[angle] || angle}

## 风格要求
${styleDescriptions[style] || style}

## 写作优先级（从高到低）
1. **人物关系** - 谁和谁在一起、互动方式、关系变化是故事核心
2. **情感体验** - 这一刻的情绪和感受
3. **事件本身** - 在做什么、发生了什么
4. **场景氛围** - 环境作为点缀
5. **地点信息** - 仅作为背景提及，不要以地点为主线

## 写作规则
- 使用第三人称（她/他）
- 字数 40-80 字
- 标题简短有悬念（5-12字）
- 结尾留白，不把话说满
- 包含具体细节（时间、数字、颜色等）
- 不要写"她去了XX地方"的流水账，写有人物关系的故事

直接输出 JSON：
{
  "title": "故事标题",
  "body": "故事正文"
}`;
  }

  /**
   * 构建任务结果
   */
  private buildTaskResult(
    taskId: string,
    finalText: string,
    photoAnalysis: any,
    memories: any[],
    stories: Story[],
    steps: string[],
    startTime: number
  ): TaskResult {
    // 找出最佳故事
    const sortedStories = [...stories].sort((a, b) => (b.score || 0) - (a.score || 0));
    const recommended = sortedStories[0];

    return {
      taskId,
      status: "success",
      results: {
        photoAnalysis,
        memories: memories.map(m => ({
          angleType: m.angle_type,
          memoryId: m.memory?.id || m.angle_id,
          description: m.description,
          confidence: m.confidence
        })),
        stories: sortedStories.map(s => ({
          storyId: s.id,
          angle: s.angle,
          title: s.title,
          body: s.body,
          score: s.score,
          viralBreakdown: s.viralBreakdown
        }))
      },
      recommended: recommended?.id,
      reasoning: recommended
        ? `${recommended.angle} 角度评分最高 (${recommended.score?.toFixed(1) || 'N/A'})`
        : undefined,
      executionTimeMs: Date.now() - startTime
    };
  }
}
