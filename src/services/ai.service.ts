import { GoogleGenerativeAI, GenerativeModel, Part } from '@google/generative-ai';
import { StrategyService, ModelConfig } from './strategy.service';
import axios, { AxiosError } from 'axios'; // 新增：HTTP客户端
import * as fs from 'fs';
import * as path from 'path';
import { MemoryService, PhotoAnalysis } from './memory.service'; // ✅ 新增：导入记忆服务

export interface AIResponse {
  content: string;
  tokenUsage: number;
  latencyMs: number;
}

export class AIService {
  private genAI: GoogleGenerativeAI;
  private strategyService: StrategyService;
  private aiMomentsEnabled: boolean; // 新增：ai-moments开关
  private aiMomentsApiUrl: string; // 新增：ai-moments API地址
  // ✅ 新增：记忆服务和人设文件路径
  private memoryService: MemoryService;
  private personaFilePath: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.strategyService = StrategyService.getInstance();

    // 新增：读取ai-moments配置
    this.aiMomentsEnabled = process.env.USE_AI_MOMENTS === 'true';
    this.aiMomentsApiUrl = process.env.AI_MOMENTS_API || 'http://localhost:8001';

    // ✅ 新增：初始化记忆服务和人设路径
    this.memoryService = MemoryService.getInstance();
    this.personaFilePath = path.join(__dirname, '../../data/fixed-persona.json');

    console.log(`🔧 AIService初始化:`);
    console.log(`   - ai-moments集成: ${this.aiMomentsEnabled ? '✅ 启用' : '❌ 禁用'}`);
    console.log(`   - ai-moments API: ${this.aiMomentsApiUrl}`);
    console.log(`   - 人设文件: ${this.personaFilePath}`);
  }

  /**
   * 获取模型实例
   */
  private getModel(config: ModelConfig): GenerativeModel {
    return this.genAI.getGenerativeModel({
      model: config.model,
      generationConfig: {
        temperature: config.temperature,
        maxOutputTokens: config.max_tokens
      }
    });
  }

  /**
   * 分析照片批次（保留原有功能）
   */
  async analyzePhotoBatch(
    images: Array<{ data: Buffer; mimeType: string }>,
    batchInfo: { time_range: string; photo_count: number; exif_context?: string },
    protagonistHints?: string
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const modelConfig = this.strategyService.getModelConfig('photo_analysis');
    const model = this.getModel(modelConfig);

    // 渲染Prompt
    const { system, user } = this.strategyService.renderPrompt('photo_analysis', {
      batch_info: batchInfo,
      protagonist_hints: protagonistHints
    });

    // 构建图片parts
    const imageParts: Part[] = images.map((img, index) => ({
      inlineData: {
        data: img.data.toString('base64'),
        mimeType: img.mimeType
      }
    }));

    // 构建最终的 user prompt（包含 EXIF 上下文）
    let finalUserPrompt = user;
    if (batchInfo.exif_context) {
      finalUserPrompt = `${user}\n\n${batchInfo.exif_context}`;
      console.log('[AIService] Including EXIF context in photo analysis');
    }

    // 调用模型
    const result = await model.generateContent([
      { text: system },
      ...imageParts,
      { text: finalUserPrompt }
    ]);

    const response = result.response;
    const text = response.text();

    return {
      content: text,
      tokenUsage: response.usageMetadata?.totalTokenCount || 0,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * 生成/更新人设（保留原有功能）
   */
  async generatePersona(
    newObservations: string,
    existingPersona?: string,
    mode: 'incremental' | 'full' = 'incremental'
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const modelConfig = this.strategyService.getModelConfig('persona_generation');
    const model = this.getModel(modelConfig);

    const { system, user } = this.strategyService.renderPrompt('persona_generation', {
      existing_persona: existingPersona,
      new_observations: newObservations,
      mode
    });

    const result = await model.generateContent([
      { text: system },
      { text: user }
    ]);

    const response = result.response;

    return {
      content: response.text(),
      tokenUsage: response.usageMetadata?.totalTokenCount || 0,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * 生成故事 - 集成ai-moments版本
   */
  async generateStory(
    personaSummary: string,
    photoAnalysis: string,
    styleId: string = 'natural'
  ): Promise<AIResponse> {
    // 如果启用了ai-moments，调用新API
    if (this.aiMomentsEnabled) {
      console.log(`🤖 调用ai-moments API生成故事...`);
      return await this.generateStoryWithAIMoments(personaSummary, photoAnalysis, styleId);
    }

    // 否则使用原有Gemini生成（降级方案）
    console.log(`🔄 使用原Gemini生成（降级方案）...`);
    return await this.generateStoryWithGemini(personaSummary, photoAnalysis, styleId);
  }

  /**
   * ✅ 新增：生成多个故事（智能聚类）
   *
   * @param photoAnalysis - 照片分析结果（JSON字符串或VLM格式）
   * @param styleId - 风格ID
   * @returns 多故事生成结果
   */
  async generateMultiStory(
    photoAnalysis: string,
    styleId: string = 'natural'
  ): Promise<any> {
    console.log(`\n🎯 开始多故事生成...`);

    // 如果启用了ai-moments，调用新API
    if (this.aiMomentsEnabled) {
      return await this.generateMultiStoryWithAIMoments(photoAnalysis, styleId);
    }

    // 否则返回单故事并提示
    console.warn(`⚠️  ai-moments未启用，无法生成多故事`);
    throw new Error('多故事功能需要启用ai-moments，请在.env中设置USE_AI_MOMENTS=true');
  }

  /**
   * 使用ai-moments API生成多个故事
   */
  private async generateMultiStoryWithAIMoments(
    photoAnalysis: string,
    styleId: string
  ): Promise<any> {
    const startTime = Date.now();
    const timeout = parseInt(process.env.AI_MOMENTS_TIMEOUT || '180000', 10); // 多故事需要更长时间：3分钟

    try {
      // 1. 解析photoAnalysis为VLM格式
      const vlmData = this.parsePhotoAnalysisToVLM(photoAnalysis);

      // ========== ✅ 新增：加载人设和检索记忆 ==========
      const userProfile = await this.loadUserProfile();
      const relevantMemories = await this.retrieveRelevantMemories(photoAnalysis);

      // 2. 构建请求数据
      const requestData = {
        user_id: "pixel_user_001",
        vlm_data: vlmData,
        context: {
          mood_preference: this.mapStyleToMood(styleId)
        },
        // ========== ✅ 新增：传递人设和记忆 ==========
        user_profile: userProfile,
        memories: relevantMemories
      };

      console.log(`📤 调用ai-moments多故事接口...`);
      console.log(`   图片数量: ${vlmData.images?.length || 0}`);
      console.log(`   API地址: ${this.aiMomentsApiUrl}/api/v1/moments/multi-story`);

      // 3. 调用ai-moments多故事接口
      const response = await axios.post(
        `${this.aiMomentsApiUrl}/api/v1/moments/multi-story`,
        requestData,
        {
          timeout: timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // 4. 解析响应
      if (response.data && response.data.success) {
        const result = response.data;

        console.log(`✅ ai-moments多故事生成成功:`);
        console.log(`   故事总数: ${result.total_stories}`);
        console.log(`   摘要: ${result.summary}`);

        // 返回完整结果（包含多个故事）
        return {
          content: JSON.stringify(result),
          tokenUsage: 0,
          latencyMs: Date.now() - startTime,
          // 附加原始结果供前端使用
          data: result
        };
      } else {
        throw new Error(response.data?.error || '多故事生成失败');
      }

    } catch (error) {
      const axiosError = error as AxiosError;

      console.error(`❌ ai-moments多故事API调用失败:`, axiosError.message);

      // 如果是超时错误
      if (axiosError.code === 'ECONNABORTED') {
        console.error(`⏱️  请求超时（超过${timeout}ms）`);
      } else if (axiosError.response) {
        console.error(`📊 HTTP状态码: ${axiosError.response.status}`);
        console.error(`📄 响应数据:`, JSON.stringify(axiosError.response.data, null, 2));
      }

      // 降级：返回单故事
      console.log(`🔄 降级为单故事生成...`);
      const singleStory = await this.generateStoryWithAIMoments(
        '', // personaSummary
        photoAnalysis,
        styleId
      );

      // 包装成多故事格式返回
      const singleResult = JSON.parse(singleStory.content);
      return {
        content: singleStory.content,
        tokenUsage: singleStory.tokenUsage,
        latencyMs: singleStory.latencyMs,
        data: {
          success: true,
          total_stories: 1,
          stories: [{
            story_id: 0,
            theme: "单故事模式",
            image_ids: singleResult.photo_strategy?.selected_ids || [],
            moment_result: singleResult
          }],
          summary: "多故事处理失败，已降级为单故事模式",
          error: null
        }
      };
    }
  }

  /**
   * 新增：使用ai-moments API生成故事
   */
  private async generateStoryWithAIMoments(
    personaSummary: string,
    photoAnalysis: string,
    styleId: string
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const timeout = parseInt(process.env.AI_MOMENTS_TIMEOUT || '120000', 10); // 默认120秒

    try {
      // 1. 解析photoAnalysis为VLM格式
      const vlmData = this.parsePhotoAnalysisToVLM(photoAnalysis);

      // ========== ✅ 新增：加载人设和检索记忆 ==========
      const userProfile = await this.loadUserProfile();
      const relevantMemories = await this.retrieveRelevantMemories(photoAnalysis);

      // 2. 构建请求数据
      const requestData = {
        user_id: "pixel_user_001", // 可以从配置或session读取
        vlm_data: vlmData,
        context: {
          mood_preference: this.mapStyleToMood(styleId)
        },
        // ✅ 新增：传递人设和记忆
        user_profile: userProfile,
        memories: relevantMemories
      };

      console.log(`📤 发送请求到ai-moments: ${this.aiMomentsApiUrl}/api/v1/moments/generate`);
      console.log(`   - 用户人设: ${userProfile?.name || 'N/A'}`);
      console.log(`   - 相关记忆: ${relevantMemories?.length || 0} 条`);

      // 3. 调用ai-moments API
      const response = await axios.post(
        `${this.aiMomentsApiUrl}/api/v1/moments/generate`,
        requestData,
        {
          timeout: timeout,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // 4. 解析响应
      if (response.data && response.data.success && response.data.data) {
        const data = response.data.data;
        const moment = data.moment || {};
        const captions = moment.captions || {};
        const primaryCaption = captions.primary || {};
        const engagement = data.engagement_prediction || {};

        // ========== ✅ 新增：提取5轮迭代的（文案 + 图片ID）==========
        const decisionProcess = data.decision_process || {};
        const historyAttempts = decisionProcess.history_attempts || {};
        const iterationHistory: Array<{
          iteration: number;
          caption: string;
          photoIds: string[];
          auditScore?: number;
          strategy?: string;
        }> = [];

        // 遍历 5 轮迭代
        for (let i = 1; i <= 5; i++) {
          const iterKey = `iteration_${i}`;
          if (historyAttempts[iterKey]) {
            const iteration = historyAttempts[iterKey];
            const toolResults = iteration.tool_results || {};

            // 提取文案
            const story = toolResults.story || {};
            const caption = story.story_caption || '';

            // 提取图片ID
            const photoStrategy = toolResults.photo_strategy || {};
            const photoIds = photoStrategy.selected_ids || [];

            // 提取审计分数
            const audit = iteration.audit || {};
            const auditScore = audit.total_score;

            // 提取策略
            const decision = iteration.decision || {};
            const strategy = decision.proposed_strategy || story.strategy_id || '';

            iterationHistory.push({
              iteration: i,
              caption,
              photoIds,
              auditScore,
              strategy
            });

            console.log(`   第${i}轮: ${caption.substring(0, 30)}... | 图片: ${photoIds.length}张 | 审计: ${auditScore || 'N/A'}`);
          }
        }

        // 5. 转换为pixel期望的格式
        const result = {
          title: primaryCaption.text.substring(0, 20), // 取前20字作为标题
          body: primaryCaption.text,
          style: primaryCaption.strategy,
          hashtags: primaryCaption.hashtags || [],
          photo_strategy: moment.photo_strategy || null,
          engagement: {
            score: engagement.predicted_engagement_score || 0,
            level: engagement.expected_engagement || 'medium',
            triggers: engagement.trigger_points || []
          },
          // ========== ✅ 新增：返回5轮迭代历史 ==========
          iteration_history: iterationHistory,
          _debug: {
            reasoning: decisionProcess.reasoning || '',
            iterations: decisionProcess.iteration || 0,
            final_audit: decisionProcess.final_audit || {}
          }
        };

        console.log(`✅ ai-moments生成成功:`);
        console.log(`   策略: ${result.style}`);
        console.log(`   文案: ${result.body.substring(0, 50)}...`);
        console.log(`   迭代历史: ${iterationHistory.length}轮`);

        return {
          content: JSON.stringify(result),
          tokenUsage: 0, // ai-moments不返回token统计
          latencyMs: Date.now() - startTime
        };
      } else {
        throw new Error(response.data?.error || 'ai-moments API返回失败');
      }

    } catch (error) {
      const axiosError = error as AxiosError;

      console.error(`❌ ai-moments API调用失败:`, axiosError.message);

      // 如果是超时错误
      if (axiosError.code === 'ECONNABORTED') {
        console.error(`⏱️  请求超时（超过${timeout}ms），尝试降级方案`);
      } else if (axiosError.response) {
        console.error(`📊 HTTP状态码: ${axiosError.response.status}`);
        console.error(`📄 响应数据:`, JSON.stringify(axiosError.response.data, null, 2));
      }

      // 降级到Gemini
      console.log(`🔄 降级到Gemini生成...`);
      return await this.generateStoryWithGemini(personaSummary, photoAnalysis, styleId);
    }
  }

  /**
   * 新增：解析photoAnalysis为VLM格式
   */
  private parsePhotoAnalysisToVLM(photoAnalysis: string): any {
    try {
      const parsed = JSON.parse(photoAnalysis);

      // 如果输入已经包含 images 数组（多故事模式），直接使用
      if (parsed.images && Array.isArray(parsed.images) && parsed.images.length > 0) {
        return {
          images: parsed.images,
          overall_theme: parsed.overall_theme || '多主题记录',
          mood: parsed.mood || '轻松'
        };
      }

      // 否则，解析为单图格式
      return {
        images: [{
          image_id: "current_photo_001",
          description: parsed.description || parsed.summary || photoAnalysis.substring(0, 200),
          objects: parsed.objects || parsed.entities || [],
          emotions: parsed.emotions || parsed.moods || [],
          colors: parsed.colors || [],
          metadata: {
            location: parsed.location || '',
            time: parsed.time || ''
          }
        }],
        overall_theme: parsed.theme || parsed.overall_theme || '日常生活',
        mood: parsed.mood || '轻松'
      };
    } catch (e) {
      // 如果JSON解析失败，创建简单的VLM格式
      return {
        images: [{
          image_id: "current_photo_001",
          description: photoAnalysis.substring(0, 200),
          objects: [],
          emotions: [],
          colors: [],
          metadata: {}
        }],
        overall_theme: '日常生活',
        mood: '轻松'
      };
    }
  }

  /**
   * 新增：映射风格ID到情绪偏好
   */
  private mapStyleToMood(styleId: string): string {
    const styleMap: Record<string, string> = {
      'natural': '轻松',
      'literary': '感性',
      'humorous': '幽默'
    };
    return styleMap[styleId] || '轻松';
  }

  /**
   * 保留：原有Gemini生成方法（作为降级方案）
   */
  private async generateStoryWithGemini(
    personaSummary: string,
    photoAnalysis: string,
    styleId: string
  ): Promise<AIResponse> {
    const startTime = Date.now();
    const modelConfig = this.strategyService.getModelConfig('story_generation');
    const model = this.getModel(modelConfig);

    const strategy = this.strategyService.getCurrentStrategy();
    const style = this.strategyService.getStoryStyle(styleId) || {
      id: 'natural',
      name: '自然流畅',
      description: '像朋友分享一样自然'
    };

    const { system, user } = this.strategyService.renderPrompt('story_generation', {
      persona_summary: personaSummary,
      photo_analysis: photoAnalysis,
      style,
      word_count: {
        min: strategy.story.word_count_range[0],
        max: strategy.story.word_count_range[1]
      }
    });

    const result = await model.generateContent([
      { text: system },
      { text: user }
    ]);

    const response = result.response;

    return {
      content: response.text(),
      tokenUsage: response.usageMetadata?.totalTokenCount || 0,
      latencyMs: Date.now() - startTime
    };
  }

  /**
   * 解析JSON响应
   */
  parseJsonResponse<T>(content: string): T {
    // 提取JSON块
    const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : content;

    try {
      return JSON.parse(jsonStr.trim());
    } catch (e) {
      console.error('Failed to parse JSON:', jsonStr);
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  /**
   * ✅ 新增：加载用户人设
   */
  private async loadUserProfile(): Promise<any | null> {
    try {
      if (!fs.existsSync(this.personaFilePath)) {
        console.warn(`⚠️ 人设文件不存在: ${this.personaFilePath}`);
        return null;
      }

      const personaData = JSON.parse(fs.readFileSync(this.personaFilePath, 'utf-8'));

      // 转换为 ai-moments 期望的格式
      const userProfile = {
        name: personaData.name || personaData.basics?.identity,
        professional_identity: personaData.basics?.identity,
        age: personaData.basics?.age?.toString(),
        location: personaData.basics?.location,
        relationship_status: personaData.basics?.relationship,
        interests: personaData.personality?.values || [],
        aesthetic_preference: personaData.personality?.aesthetic,
        personality_traits: personaData.personality?.traits || [],
        writing_style: personaData.writing_style?.tone ? [personaData.writing_style.tone] : [],
        preferred_themes: personaData.writing_style?.favorite_themes || [],
        raw_profile: personaData  // 保留原始数据
      };

      console.log(`✅ 成功加载人设: ${userProfile.name}`);
      return userProfile;

    } catch (error) {
      console.error(`❌ 加载人设失败:`, error);
      return null;
    }
  }

  /**
   * ✅ 新增：检索相关记忆
   */
  private async retrieveRelevantMemories(photoAnalysis: string): Promise<any[] | null> {
    try {
      // 1. 解析 photoAnalysis
      let analysis: any;
      try {
        analysis = JSON.parse(photoAnalysis);
      } catch {
        // 如果不是 JSON，创建简单结构
        analysis = {
          entities: [],
          emotion: 'neutral',
          location: null
        };
      }

      // 2. 构建检索参数
      const photoAnalysisInput: PhotoAnalysis = {
        entities: analysis.entities || analysis.objects || [],
        people: analysis.people || [],
        location: analysis.location || null,
        emotion: analysis.emotion || analysis.mood || null,
        activities: analysis.activities || []
      };

      // 3. 调用 MemoryService 检索
      const retrievalResult = await this.memoryService.retrieve4Path(
        photoAnalysisInput,
        ['all'],  // 4 路径全开
        20,       // Top 20
        0.5       // 最小置信度
      );

      // 4. 取 Top 20 记忆
      const topMemories = retrievalResult.top_narrative_angles
        .slice(0, 20)
        .map(angle => ({
          memory_id: angle.memory.id,
          content: angle.memory.content,
          category: angle.memory.type,
          importance_score: 10,  // 可以从 angle.confidence 转换
          date: angle.memory.date,
          entities: angle.memory.entities || [],
          location: angle.memory.location,
          emotion: angle.memory.emotion,
          people: angle.memory.people || [],
          images: [],  // 暂不传递图片详情
          // 额外信息：检索到的角度和置信度
          retrieval_info: {
            angle_type: angle.angle_type,
            confidence: angle.confidence,
            description: angle.description
          }
        }));

      console.log(`✅ 检索到 ${topMemories.length} 条相关记忆`);
      return topMemories;

    } catch (error) {
      console.error(`❌ 检索记忆失败:`, error);
      return null;
    }
  }
}
