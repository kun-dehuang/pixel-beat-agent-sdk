/**
 * Pixel Beat Agent V3 - 对话层
 * 双层架构：对话层 (Pixel Beat) + 执行层 (Execution Agent)
 *
 * 职责：
 * - 理解用户意图
 * - 分发任务给 Execution Agent（只说 WHAT，不说 HOW）
 * - 汇总结果并呈现给用户
 * - 管理确认节点（故事预览、发布确认）
 * - 维护狗仔队人格
 */

import Anthropic from "@anthropic-ai/sdk";
import { ExecutionAgent } from "./execution.agent";
import {
  AgentV3Input,
  AgentV3Output,
  Task,
  TaskResult,
  Story,
  StoryPreview,
  ConfirmationState,
  SubagentTask
} from "./types";

// 对话层 System Prompt
const DIALOGUE_SYSTEM_PROMPT = `你是 Pixel Beat，一位依附在用户手机相册里的 AI 狗仔队。

你的使命是以第三人称视角报道和记录用户的生活故事，帮助用户向亲密关系圈分享生活、获得互动反馈。

## 你善于发现
1. **隐形炫耀** - 那些用户想分享但不好意思直说的成就和美好
2. **情绪反常** - 突破日常的情感波动，值得被记录的瞬间
3. **分享价值** - 能引发亲密朋友共鸣和互动的内容

## 双层架构
你运行在一个双层 Agent 系统中：
1. **你 (Pixel Beat)** - 对话层：与用户交互、分发任务、管理确认
2. **Execution Agent** - 执行层：执行具体任务、返回结构化结果

你通过 dispatch_task 向执行层分发任务。

## 任务分发规则
向 Execution Agent 分发任务时，只描述目标，不指定方法：

✅ 正确：
- "分析这批照片中的情绪变化和隐形炫耀点"
- "找到与当前照片情绪反差最大的历史记忆"
- "为这个场景生成 3 个不同角度的故事版本"

❌ 错误：
- "调用 analyze_photos 工具..."
- "使用 4-Path 检索..."
- "用 gossip 风格生成..."

## 确认流程
故事发布前必须获得用户确认：
1. 收到执行层返回的 story_id
2. 调用 display_story 展示预览
3. 等待用户反馈：
   - 👍 / "好" / "发" → publish_story
   - 👎 / "换" → dispatch_task("换一个角度重新生成")
   - 具体修改意见 → dispatch_task("根据反馈调整")

## 人格规则
1. **狗仔队口吻** - 用"她/他"第三人称，像在报道独家新闻
2. **制造悬念** - 标题和开头要吊人胃口
3. **适度八卦** - 可以调侃，但保持温暖底色
4. **简洁有力** - 不废话，不问"还需要什么吗"
5. **自然人味** - "看看有什么料" 而非 "我来帮您分析"

## 可用工具
1. dispatch_task - 向执行层分发任务
2. display_story - 展示故事预览
3. notify_user - 向用户发通知（非阻塞）

## 输出格式
任务完成后，输出 JSON：
{
  "status": "success" | "pending_confirmation",
  "message": "给用户的消息",
  "story_preview": { ... },
  "alternatives": [ ... ]
}`;

// 对话层工具定义
const DIALOGUE_TOOLS: Anthropic.Tool[] = [
  {
    name: "dispatch_task",
    description: "向 Execution Agent 分发任务。只描述目标，不指定具体方法。",
    input_schema: {
      type: "object" as const,
      properties: {
        goal: {
          type: "string",
          description: "任务目标描述（只说 WHAT，不说 HOW）"
        },
        context: {
          type: "object",
          description: "任务上下文（分析结果、用户偏好等）"
        },
        priority: {
          type: "string",
          enum: ["high", "normal", "low"],
          description: "任务优先级"
        }
      },
      required: ["goal"]
    }
  },
  {
    name: "display_story",
    description: "向用户展示故事预览，等待确认。",
    input_schema: {
      type: "object" as const,
      properties: {
        story_id: {
          type: "string",
          description: "故事ID"
        },
        prompt: {
          type: "string",
          description: "展示时的提示语"
        },
        show_alternatives: {
          type: "boolean",
          description: "是否显示其他候选版本"
        }
      },
      required: ["story_id"]
    }
  },
  {
    name: "notify_user",
    description: "向用户发送通知，不等待回复（非阻塞）。",
    input_schema: {
      type: "object" as const,
      properties: {
        message: {
          type: "string",
          description: "通知内容"
        },
        type: {
          type: "string",
          enum: ["progress", "discovery", "insight", "completion"],
          description: "通知类型"
        }
      },
      required: ["message", "type"]
    }
  }
];

/**
 * Pixel Beat Agent V3 - 对话层
 */
export class PixelBeatAgentV3 {
  private anthropic: Anthropic;
  private executionAgent: ExecutionAgent;
  private pendingStories: Map<string, Story> = new Map();
  private confirmationState: ConfirmationState | null = null;
  private taskCounter: number = 0;
  private notifications: string[] = [];

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.anthropic = new Anthropic({ apiKey });
    this.executionAgent = new ExecutionAgent();
    console.log("✅ Pixel Beat Agent V3 initialized (Dual-Layer Architecture)");
  }

  /**
   * 运行 Agent - 主入口
   */
  async run(input: AgentV3Input): Promise<AgentV3Output> {
    const startTime = Date.now();
    const dialogueSteps: string[] = [];
    const executionSteps: string[] = [];
    let totalTokens = 0;
    let dialogueTurns = 0;
    let executionTurns = 0;
    const maxTurns = 6;

    console.log(`\n🎬 Pixel Beat V3 starting for user: ${input.userId}`);
    console.log(`   📸 Photos: ${input.photos.length}`);
    console.log(`   🔄 Mode: Dual-Layer Architecture`);

    // 重置状态
    this.notifications = [];
    this.pendingStories.clear();

    // 构建初始消息
    const initialMessage = this.buildInitialMessage(input);

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: initialMessage }
    ];

    // 存储执行结果
    let lastTaskResult: TaskResult | null = null;
    let bestStory: Story | null = null;
    let alternatives: Story[] = [];

    try {
      while (dialogueTurns < maxTurns) {
        dialogueTurns++;
        console.log(`\n  ===== Dialogue Turn ${dialogueTurns} =====`);

        const response = await this.anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2048,
          system: DIALOGUE_SYSTEM_PROMPT,
          tools: DIALOGUE_TOOLS,
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

              console.log(`  🎯 ${toolName}`);
              dialogueSteps.push(toolName);

              let result: string;

              switch (toolName) {
                case "dispatch_task": {
                  // 创建任务并分发给执行层
                  const task: Task = {
                    id: `task_${++this.taskCounter}`,
                    goal: toolInput.goal,
                    context: toolInput.context || {},
                    priority: toolInput.priority || 'normal',
                    status: 'pending',
                    createdAt: Date.now()
                  };

                  console.log(`     📤 Dispatching: "${task.goal.substring(0, 50)}..."`);

                  // 执行任务
                  lastTaskResult = await this.executionAgent.execute(task, input.photos);
                  executionTurns++;

                  // 收集执行步骤
                  if (lastTaskResult.results?.stories) {
                    const stories = lastTaskResult.results.stories as any[];
                    stories.forEach((s: any) => {
                      const story: Story = {
                        id: s.storyId || `story_${Date.now()}`,
                        title: s.title,
                        body: s.body,
                        angle: s.angle,
                        style: 'natural',
                        score: s.score,
                        viralBreakdown: s.viralBreakdown,
                        createdAt: Date.now()
                      };
                      this.pendingStories.set(story.id, story);

                      if (!bestStory || (story.score || 0) > (bestStory.score || 0)) {
                        bestStory = story;
                      } else {
                        alternatives.push(story);
                      }
                    });
                  }

                  result = JSON.stringify(lastTaskResult);
                  break;
                }

                case "display_story": {
                  const storyId = toolInput.story_id;
                  const story = this.pendingStories.get(storyId) ||
                    this.executionAgent.getStory(storyId) ||
                    bestStory;

                  if (story) {
                    const preview: StoryPreview = {
                      storyId: story.id,
                      story,
                      predictedEngagement: {
                        likes: Math.round((story.score || 7) * 4),
                        comments: Math.round((story.score || 7) * 2),
                        likelyReactions: this.predictReactions(story)
                      },
                      alternatives: toolInput.show_alternatives ? alternatives : undefined
                    };

                    this.confirmationState = {
                      storyId: story.id,
                      status: 'pending'
                    };

                    result = JSON.stringify({
                      success: true,
                      preview,
                      prompt: toolInput.prompt || "这个故事怎么样？"
                    });
                  } else {
                    result = JSON.stringify({ success: false, error: "Story not found" });
                  }
                  break;
                }

                case "notify_user": {
                  this.notifications.push(toolInput.message);
                  result = JSON.stringify({ success: true, delivered: true });
                  break;
                }

                default:
                  result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
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
          console.log(`  ✅ Dialogue completed in ${dialogueTurns} turns`);

          const textBlock = response.content.find(b => b.type === "text");
          const finalText = textBlock ? (textBlock as any).text : "";

          // 构建输出
          return this.buildOutput(
            finalText,
            bestStory,
            alternatives,
            lastTaskResult,
            dialogueSteps,
            executionSteps,
            totalTokens,
            startTime,
            dialogueTurns,
            executionTurns
          );
        } else {
          break;
        }
      }

      // 超过最大轮次
      return {
        status: "error",
        error: "Max dialogue turns reached",
        debug: {
          dialogueSteps,
          executionSteps,
          totalTokens,
          totalLatencyMs: Date.now() - startTime,
          dialogueTurns,
          executionTurns
        }
      };

    } catch (error) {
      console.error("Agent V3 error:", error);
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Unknown error",
        debug: {
          dialogueSteps,
          executionSteps,
          totalTokens,
          totalLatencyMs: Date.now() - startTime,
          dialogueTurns,
          executionTurns
        }
      };
    }
  }

  /**
   * 处理用户确认
   */
  async handleConfirmation(
    storyId: string,
    confirmed: boolean,
    feedback?: string
  ): Promise<{ success: boolean; message: string }> {
    const story = this.pendingStories.get(storyId);

    if (!story) {
      return { success: false, message: "Story not found" };
    }

    if (confirmed) {
      // 用户确认，模拟发布
      console.log(`📤 Publishing story: ${storyId}`);
      this.pendingStories.delete(storyId);
      return {
        success: true,
        message: "已发布！坐等朋友们的反应吧 👀"
      };
    } else {
      // 用户不满意
      this.confirmationState = {
        storyId,
        status: 'rejected',
        feedback
      };
      return {
        success: true,
        message: feedback
          ? `收到反馈，正在调整: ${feedback}`
          : "好的，换一个角度重新生成..."
      };
    }
  }

  /**
   * 构建初始消息
   */
  private buildInitialMessage(input: AgentV3Input): string {
    const parts: string[] = [];

    parts.push(`用户上传了 ${input.photos.length} 张照片，请帮我创作一个有趣的朋友圈故事。`);

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

    parts.push(`\n\n请先发送一条简短的通知表示你开始工作了，然后分发任务给执行层分析照片。`);

    return parts.join("");
  }

  /**
   * 预测可能的反应
   */
  private predictReactions(story: Story): string[] {
    const reactions: string[] = [];

    if (story.angle === 'hidden_flex') {
      reactions.push("这是在哪？", "羡慕了", "带我！");
    } else if (story.angle === 'emotion_peak') {
      reactions.push("发生了什么？", "抱抱", "太懂了");
    } else if (story.angle === 'time_contrast') {
      reactions.push("变化好大！", "为你骄傲", "时间过得真快");
    } else {
      reactions.push("好看", "在哪里", "下次一起");
    }

    return reactions;
  }

  /**
   * 构建输出
   */
  private buildOutput(
    finalText: string,
    bestStory: Story | null,
    alternatives: Story[],
    taskResult: TaskResult | null,
    dialogueSteps: string[],
    executionSteps: string[],
    totalTokens: number,
    startTime: number,
    dialogueTurns: number,
    executionTurns: number
  ): AgentV3Output {
    const hasPendingConfirmation = this.confirmationState?.status === 'pending';

    const output: AgentV3Output = {
      status: hasPendingConfirmation ? "pending_confirmation" : "success",
      debug: {
        dialogueSteps,
        executionSteps,
        totalTokens,
        totalLatencyMs: Date.now() - startTime,
        dialogueTurns,
        executionTurns
      }
    };

    if (bestStory) {
      output.story = bestStory;
      output.storyPreview = {
        storyId: bestStory.id,
        story: bestStory,
        predictedEngagement: {
          likes: Math.round((bestStory.score || 7) * 4),
          comments: Math.round((bestStory.score || 7) * 2),
          likelyReactions: this.predictReactions(bestStory)
        },
        alternatives: alternatives.length > 0 ? alternatives : undefined
      };
      output.engagementScore = bestStory.score;
      output.viralBreakdown = bestStory.viralBreakdown;
    }

    if (taskResult?.results) {
      output.photoAnalysis = taskResult.results.photoAnalysis;
      output.memoryConnections = taskResult.results.memories;

      if (taskResult.reasoning) {
        output.reasoning = {
          memoryDecision: taskResult.results.memories?.length > 0 ? "检索到相关记忆" : "未检索记忆",
          memoryUsed: (taskResult.results.memories?.length || 0) > 0,
          strategyChoice: bestStory?.angle || "share_value",
          strategyReason: taskResult.reasoning
        };
      }
    }

    if (alternatives.length > 0) {
      output.alternatives = alternatives;
    }

    return output;
  }
}
