/**
 * Pixel Beat 工具集 V2
 * 基于 Mnemonic Director V1.6 的 4-Path 海马体检索 + 5维流量评分
 */

import { z } from "zod";
import { AxiosError } from "axios";
import { AIService } from "../services/ai.service";
import { MemoryService, PhotoAnalysis, RetrievalPath, NarrativeAngle } from "../services/memory.service";
import { userMemoryService } from "../services/user-memory.service";
import { getMem0Middleware } from "../services/mem0.middleware";
import { memorySelectService } from "../services/memory-select.service";

// 工具返回格式
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

// ==================== Schema 定义 ====================

// 照片分析工具 Schema
export const AnalyzePhotosSchema = z.object({
  images: z.array(z.object({
    base64: z.string(),
    mimeType: z.string().default("image/jpeg"),
    exif: z.any().optional()
  })),
  timeRange: z.string().optional(),
  protagonistHints: z.string().optional(),
  exifContext: z.string().optional()  // EXIF 元数据上下文
});
export type AnalyzePhotosInput = z.infer<typeof AnalyzePhotosSchema>;

// 人设生成工具 Schema
export const GeneratePersonaSchema = z.object({
  photoAnalysis: z.string(),
  existingPersona: z.string().optional(),
  mode: z.enum(["full", "incremental"]).default("incremental")
});
export type GeneratePersonaInput = z.infer<typeof GeneratePersonaSchema>;

// 故事生成工具 Schema
export const GenerateStorySchema = z.object({
  personaSummary: z.string(),
  photoAnalysis: z.string(),
  styleId: z.enum(["natural", "literary", "humorous"]).default("natural"),
  avoidSimilarTo: z.string().optional()
});
export type GenerateStoryInput = z.infer<typeof GenerateStorySchema>;

// 质量评估工具 Schema
export const EvaluateQualitySchema = z.object({
  contentType: z.enum(["story", "persona"]),
  content: z.string(),
  originalPhotos: z.string().optional()
});
export type EvaluateQualityInput = z.infer<typeof EvaluateQualitySchema>;

// 4-Path 记忆检索工具 Schema
export const RetrieveMemoriesSchema = z.object({
  photoAnalysis: z.object({
    entities: z.array(z.string()).optional(),
    people: z.array(z.string()).optional(),
    location: z.string().optional(),
    emotion: z.string().optional(),
    activities: z.array(z.string()).optional()
  }),
  paths: z.array(z.enum(["entity", "emotion_echo", "emotion_contrast", "location", "person", "all"])).default(["all"]),
  topK: z.number().default(3),
  minConfidence: z.number().default(0.5)
});
export type RetrieveMemoriesInput = z.infer<typeof RetrieveMemoriesSchema>;

// 5维流量评分工具 Schema
export const PredictEngagementSchema = z.object({
  story: z.object({
    title: z.string(),
    body: z.string(),
    style: z.string().optional()
  }),
  narrativeAngle: z.object({
    angle_type: z.string(),
    confidence: z.number(),
    description: z.string().optional()
  }).optional(),
  hasOldPhoto: z.boolean().default(false),
  associatedMemories: z.array(z.object({
    id: z.string(),
    content: z.string(),
    emotion: z.string().optional()
  })).optional()
});
export type PredictEngagementInput = z.infer<typeof PredictEngagementSchema>;

// ==================== Memory Select 工具 Schema ====================

/**
 * 添加记忆到 memory-select 服务
 */
export const MemorySelectAddSchema = z.object({
  uid: z.string().describe("User ID for memory isolation"),
  text: z.string().describe("Memory text content to store"),
  metadata: z.record(z.any()).optional().describe("Optional metadata associated with the memory")
});
export type MemorySelectAddInput = z.infer<typeof MemorySelectAddSchema>;

/**
 * 查询记忆并生成 AI 答案
 */
export const MemorySelectSelectWithAnswerSchema = z.object({
  query: z.string().describe("Question or search query"),
  limit: z.number().default(5).describe("Maximum number of results (default: 5)"),
  uid: z.string().optional().describe("User ID to filter memories")
});
export type MemorySelectSelectWithAnswerInput = z.infer<typeof MemorySelectSelectWithAnswerSchema>;

// ==================== 工具处理函数 ====================

/**
 * 工具处理函数类
 */
export class ToolHandlers {
  private aiService: AIService;
  private memoryService: MemoryService;

  constructor() {
    this.aiService = new AIService();
    this.memoryService = MemoryService.getInstance();
    // 预加载记忆数据
    this.memoryService.loadMemories().catch(err => {
      console.error('[ToolHandlers] Failed to preload memories:', err);
    });
  }

  // 照片分析
  async analyzePhotos(args: AnalyzePhotosInput): Promise<ToolResult> {
    const imageBuffers = args.images.map(img => ({
      data: Buffer.from(img.base64, "base64"),
      mimeType: img.mimeType
    }));

    const result = await this.aiService.analyzePhotoBatch(
      imageBuffers,
      {
        time_range: args.timeRange || "今日",
        photo_count: args.images.length,
        exif_context: args.exifContext || ""  // 传递 EXIF 上下文
      },
      args.protagonistHints
    );

    const analysis = this.aiService.parseJsonResponse(result.content);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          analysis,
          metadata: {
            photoCount: args.images.length,
            tokenUsage: result.tokenUsage,
            latencyMs: result.latencyMs,
            hasExif: !!args.exifContext
          }
        }, null, 2)
      }]
    };
  }

  // 人设生成
  async generatePersona(args: GeneratePersonaInput): Promise<ToolResult> {
    const result = await this.aiService.generatePersona(
      args.photoAnalysis,
      args.existingPersona,
      args.mode
    );

    const persona = this.aiService.parseJsonResponse(result.content);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          persona,
          mode: args.mode,
          metadata: {
            tokenUsage: result.tokenUsage,
            latencyMs: result.latencyMs
          }
        }, null, 2)
      }]
    };
  }

  // 故事生成
  async generateStory(args: GenerateStoryInput): Promise<ToolResult> {
    const result = await this.aiService.generateStory(
      args.personaSummary,
      args.photoAnalysis,
      args.styleId
    );

    let story;
    let iterationHistory;
    try {
      const parsedResult = this.aiService.parseJsonResponse<any>(result.content);
      story = {
        title: parsedResult.title || "",
        body: parsedResult.body || ""
      };
      // ✅ 提取 iteration_history（ai-moments 返回的5轮迭代数据）
      iterationHistory = parsedResult.iteration_history;
    } catch {
      story = { title: "", body: result.content };
      iterationHistory = undefined;
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          story,
          style: args.styleId,
          iteration_history: iterationHistory,  // ✅ 新增：返回5轮迭代历史
          metadata: {
            tokenUsage: result.tokenUsage,
            latencyMs: result.latencyMs
          }
        }, null, 2)
      }]
    };
  }

  // 质量评估
  async evaluateQuality(args: EvaluateQualityInput): Promise<ToolResult> {
    const evaluationPrompt = `
作为质量评审员，评估以下${args.contentType === "story" ? "故事" : "人设"}：

${args.content}

${args.originalPhotos ? `原始照片分析：${args.originalPhotos}` : ""}

评估维度：
${args.contentType === "story"
  ? "1. 情感共鸣 2. 细节丰富度 3. 与照片一致性 4. 语言流畅度 5. 风格统一性"
  : "1. 维度完整性 2. 特征准确性 3. 无内部矛盾 4. 有洞察力"}

返回 JSON：
{
  "score": 8,
  "breakdown": { "情感共鸣": 9, "细节丰富度": 7 },
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["不足1"],
  "suggestions": ["具体改进建议"],
  "shouldRegenerate": false,
  "recommendedStyle": "literary"
}`;

    const result = await this.aiService.generateStory(evaluationPrompt, "", "natural");

    return {
      content: [{
        type: "text",
        text: result.content
      }]
    };
  }

  /**
   * 混合记忆检索 - 用户隔离的 4-Path 检索
   * 每个用户独立，基于 userId 从 MongoDB 检索
   */
  async retrieveMemories(args: RetrieveMemoriesInput, userId?: string): Promise<ToolResult> {
    try {
      const effectiveUserId = userId || 'demo_user';

      console.log(`[RetrieveMemories] User: ${effectiveUserId.substring(0, 12)}...`);

      // 从照片分析提取查询关键词
      const analysis = args.photoAnalysis as any;
      const queryParts: string[] = [];

      if (analysis.description) queryParts.push(analysis.description);
      if (analysis.setting) queryParts.push(analysis.setting);
      if (analysis.mood) queryParts.push(analysis.mood);
      if (analysis.activities) queryParts.push(analysis.activities.join(' '));
      if (analysis.objects) queryParts.push(analysis.objects.join(' '));

      const query = queryParts.join(' ').substring(0, 200) || '日常生活';

      console.log(`[RetrieveMemories] Search query: "${query.substring(0, 50)}..."`);

      // 使用 UserMemoryService 的 4-Path 检索（按 userId 隔离）
      const fourPathResult = await userMemoryService.retrieve4Path(
        effectiveUserId,
        args.photoAnalysis as any,
        args.topK
      );

      // 同时执行关键词搜索作为补充
      const keywordResults = await userMemoryService.keywordSearch(effectiveUserId, query, args.topK || 5);

      // 获取用户记忆统计
      const stats = await userMemoryService.getStats(effectiveUserId);

      // 格式化输出
      const formattedResult = {
        success: true,
        retrieval_mode: 'user_isolated',
        retrieval_summary: {
          keyword_count: keywordResults.length,
          fourpath_total: fourPathResult.top_narrative_angles.length,
          user_total_memories: stats.total
        },
        // 关键词搜索结果
        hybrid_results: keywordResults.map((m: any) => ({
          source: 'keyword',
          content: m.content,
          score: 0.7,
          angle_type: m.type
        })),
        // 4-Path 结果
        top_narrative_angles: fourPathResult.top_narrative_angles.map(this.formatAngle),
        // 统计
        memory_stats: stats
      };

      console.log(`[RetrieveMemories] Found ${keywordResults.length} keyword + ${fourPathResult.top_narrative_angles.length} 4-path results for user: ${effectiveUserId.substring(0, 12)}...`);

      return {
        content: [{
          type: "text",
          text: JSON.stringify(formattedResult, null, 2)
        }]
      };
    } catch (error) {
      console.error('[RetrieveMemories] Error:', error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error"
          })
        }]
      };
    }
  }

  /**
   * 格式化叙事角度输出
   */
  private formatAngle(angle: NarrativeAngle): object {
    return {
      angle_id: angle.angle_id,
      angle_name: angle.angle_name,
      angle_type: angle.angle_type,
      confidence: angle.confidence,
      description: angle.description,
      matched_items: angle.matched_items,
      memory: {
        id: angle.memory.id,
        date: angle.memory.date,
        content: angle.memory.content,
        type: angle.memory.type,
        emotion: angle.memory.emotion,
        location: angle.memory.location
      }
    };
  }

  /**
   * 5维流量评分 + 互动预测
   * 基于 Mnemonic Director V1.6 的评分体系
   */
  async predictEngagement(args: PredictEngagementInput): Promise<ToolResult> {
    const angleType = args.narrativeAngle?.angle_type || 'default';
    const hasOldPhoto = args.hasOldPhoto;

    // 基础分数映射
    const baseScores: Record<string, Record<string, number>> = {
      "emotional_contrast": {
        gossip: 8.0, hotness: 7.5, status: 7.0, class: 8.0, memory: 9.5
      },
      "emotional_echo": {
        gossip: 5.0, hotness: 7.0, status: 6.0, class: 7.0, memory: 7.0
      },
      "entity_continuation": {
        gossip: 4.0, hotness: 5.0, status: 6.0, class: 7.0, memory: 7.0
      },
      "contextual_anchor": {
        gossip: 5.0, hotness: 6.0, status: 6.5, class: 7.5, memory: 7.5
      },
      "social_bond": {
        gossip: 6.5, hotness: 7.0, status: 7.5, class: 7.0, memory: 8.0
      },
      "default": {
        gossip: 5.0, hotness: 6.0, status: 6.0, class: 6.5, memory: 6.0
      }
    };

    const scores = { ...(baseScores[angleType] || baseScores["default"]) };

    // 如果含旧图，提升分数
    if (hasOldPhoto) {
      scores.memory += 1.5;
      scores.gossip += 1.0;
    }

    // 根据故事内容调整分数
    const storyLength = args.story.body.length;
    if (storyLength >= 40 && storyLength <= 80) {
      scores.class += 1.0; // 字数恰当（40-80字）
    } else if (storyLength > 80) {
      scores.class -= 0.5; // 超字数扣分
    }

    // 检查是否有悬念/反转元素（八卦感）
    const suspenseKeywords = ['终于', '竟然', '没想到', '却', '原来', '半年', '两个月', '偷偷', '居然', '谁能想到'];
    const hasSuspense = suspenseKeywords.some(kw => args.story.body.includes(kw));
    if (hasSuspense) {
      scores.gossip += 1.5;
    }

    // 检查装逼元素
    const flexKeywords = ['低调', '随手', '不经意', '日常', '又', '顺便', '刚好'];
    const hasFlex = flexKeywords.some(kw => args.story.body.includes(kw));
    if (hasFlex) {
      scores.status += 1.5;
    }

    // 计算总分（提升八卦和装逼权重）
    const total = (
      scores.gossip * 0.25 +   // 八卦度 15% → 25%
      scores.hotness * 0.15 +  // 热度 25% → 15%
      scores.status * 0.30 +   // 装逼度 25% → 30%
      scores.class * 0.15 +    // 品质感 20% → 15%
      scores.memory * 0.15     // 记忆厚度 保持 15%
    );

    // 预测互动
    const predictedLikes = Math.round(total * 4);
    const predictedComments = Math.round(total * 2);
    const deepEngagementRate = total >= 7 ? 0.75 : (total >= 6 ? 0.5 : 0.3);

    // 生成评论类型预测
    const commentTypes = this.predictCommentTypes(angleType, {
      title: args.story.title || '',
      body: args.story.body || ''
    });

    const result = {
      success: true,
      viral_score: {
        total: Math.round(total * 10) / 10,
        breakdown: {
          gossip_score: Math.round(scores.gossip * 10) / 10,
          hotness_score: Math.round(scores.hotness * 10) / 10,
          status_score: Math.round(scores.status * 10) / 10,
          class_score: Math.round(scores.class * 10) / 10,
          memory_depth_score: Math.round(scores.memory * 10) / 10
        },
        score_reasoning: {
          gossip: hasSuspense ? "有悬念元素，八卦感强" : "普通叙事，可加悬念词",
          hotness: angleType === "emotional_contrast" ? "情感共鸣强烈" : "情感适中",
          status: hasFlex ? "隐形装逼，高级感满满" : "装逼元素不足，可更含蓄",
          class: storyLength >= 40 && storyLength <= 80 ? "字数恰当（40-80字）" : "字数不符合要求",
          memory: hasOldPhoto ? "跨时间对比，记忆厚度极强" : "当下记录"
        }
      },
      engagement_prediction: {
        predicted_likes: predictedLikes,
        predicted_comments: predictedComments,
        deep_engagement_rate: deepEngagementRate,
        comment_types: commentTypes
      },
      recommendation: {
        should_use: total >= 7,
        confidence: total / 10,
        improvement_suggestions: this.getImprovementSuggestions(scores, {
          title: args.story.title || '',
          body: args.story.body || ''
        })
      }
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  /**
   * 预测评论类型
   */
  private predictCommentTypes(
    angleType: string,
    story: { title: string; body: string }
  ): Array<{ type: string; examples: string[]; probability: number }> {
    const commentMap: Record<string, Array<{ type: string; examples: string[]; probability: number }>> = {
      "emotional_contrast": [
        { type: "追问型", examples: ["发生了什么？", "这个反转太戳了"], probability: 0.4 },
        { type: "共鸣型", examples: ["为你骄傲", "太懂了"], probability: 0.35 },
        { type: "互动型", examples: ["下次带我", "在哪里"], probability: 0.25 }
      ],
      "social_bond": [
        { type: "共鸣型", examples: ["你们好美", "友情万岁"], probability: 0.4 },
        { type: "互动型", examples: ["什么时候聚", "羡慕了"], probability: 0.35 },
        { type: "追问型", examples: ["这是谁？", "介绍一下"], probability: 0.25 }
      ],
      "contextual_anchor": [
        { type: "追问型", examples: ["这是哪里？", "地址求分享"], probability: 0.4 },
        { type: "回忆型", examples: ["我也去过", "想起来了"], probability: 0.35 },
        { type: "互动型", examples: ["下次一起", "带我去"], probability: 0.25 }
      ],
      "default": [
        { type: "点赞型", examples: ["好看", "赞"], probability: 0.5 },
        { type: "互动型", examples: ["在哪里", "怎么去"], probability: 0.3 },
        { type: "共鸣型", examples: ["同款", "一样"], probability: 0.2 }
      ]
    };

    return commentMap[angleType] || commentMap["default"];
  }

  /**
   * 生成改进建议
   */
  private getImprovementSuggestions(
    scores: Record<string, number>,
    story: { title: string; body: string }
  ): string[] {
    const suggestions: string[] = [];

    if (scores.gossip < 6) {
      suggestions.push("可以增加一些悬念或反转元素");
    }
    if (scores.hotness < 6) {
      suggestions.push("可以加入更多情感细节");
    }
    if (story.body.length < 80) {
      suggestions.push("故事略短，可以增加一些具体场景描写");
    }
    if (story.body.length > 200) {
      suggestions.push("故事略长，可以精简一些");
    }
    if (scores.memory < 7) {
      suggestions.push("可以尝试关联历史记忆，增加故事厚度");
    }

    return suggestions.length > 0 ? suggestions : ["当前内容质量不错"];
  }

  // ==================== Memory Select 工具处理函数 ====================

  /**
   * 添加记忆到 memory-select 服务
   */
  async memorySelectAdd(args: MemorySelectAddInput): Promise<ToolResult> {
    try {
      const result = await memorySelectService.addMemory(
        args.uid,
        args.text,
        args.metadata
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: result
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, "memorySelectAdd");
    }
  }

  /**
   * 查询记忆并生成 AI 答案
   */
  async memorySelectSelectWithAnswer(args: MemorySelectSelectWithAnswerInput): Promise<ToolResult> {
    try {
      const result = await memorySelectService.selectWithAnswer(
        args.query,
        args.limit,
        args.uid
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: result
          }, null, 2)
        }]
      };
    } catch (error) {
      return this.handleError(error, "memorySelectSelectWithAnswer");
    }
  }

  /**
   * 统一错误处理
   */
  private handleError(error: unknown, operation: string): ToolResult {
    const axiosError = error as AxiosError;
    let message: string;

    if (axiosError?.response?.data) {
      message = typeof axiosError.response.data === 'string'
        ? axiosError.response.data
        : JSON.stringify(axiosError.response.data);
    } else if (axiosError?.message) {
      message = axiosError.message;
    } else if (error instanceof Error) {
      message = error.message;
    } else {
      message = "Unknown error";
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          error: `${operation} failed: ${message}`
        })
      }]
    };
  }
}
