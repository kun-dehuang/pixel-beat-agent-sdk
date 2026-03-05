/**
 * Paparazzi Agent V3 — 固定管线编排器
 *
 * 替代旧的 Claude Agentic Loop，实现归档方案的 5 步固定管线：
 * Step 1: ImageAnalyzer (Gemini VLM) — 视觉元素提取
 * Step 2: UserProfile (数据查询) — 用户画像加载
 * Step 3: RouterAgent (Claude Haiku) — 智能规划调用哪些专家
 * Step 4: Experts (Claude Sonnet, 并行) — FlexExpert/VibeExpert/GossipExpert
 * Step 5: CopyGenerator (Claude Sonnet, per-intent) — Gen Z Caption 生成
 *
 * LLM 分工:
 * - VLM: Gemini 2.0 Flash (复用现有 toolHandlers)
 * - Router: Claude Haiku (快速路由决策)
 * - Experts + Copy: Claude Sonnet (高质量分析和创意写作)
 */

import Anthropic from "@anthropic-ai/sdk";
import { ToolHandlers } from "../../tools";
import { personaSummaryService } from "../../services/persona-summary.service";
import { userMemoryService } from "../../services/user-memory.service";
import {
  AgentInput,
  AgentOutput,
  AgentStepEvent,
  Story,
  ExpertScores,
  PhotoInput,
  PaparazziImageAnalysis,
  PaparazziUserProfile,
  PaparazziMemoryContext,
  PaparazziRelationshipContext,
  ExpertResults,
  ExpertIntent,
  FlexIntent,
  VibeIntent,
  GossipIntent,
  CopyCandidate,
  PipelineStepDetail
} from "./types";
import { promptConfigManager } from "./prompt-config";

// ==================== PaparazziOrchestrator ====================

export class PaparazziOrchestrator {
  private client: Anthropic;
  private toolHandlers: ToolHandlers;
  private photos: PhotoInput[] = [];

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required");
    }
    this.client = new Anthropic({ apiKey });
    this.toolHandlers = new ToolHandlers();
    console.log("✅ PaparazziOrchestrator V3 initialized (Gemini VLM + Claude Haiku/Sonnet)");
  }

  /**
   * 运行 Agent — 固定 5 步管线
   */
  async run(input: AgentInput, onStep?: (event: AgentStepEvent) => void): Promise<AgentOutput> {
    const TIMEOUT_MS = 60000; // 60s 超时（管线比 agentic loop 快）

    const timeoutPromise = new Promise<AgentOutput>((_, reject) => {
      setTimeout(() => reject(new Error('Pipeline timeout after 60s')), TIMEOUT_MS);
    });

    try {
      return await Promise.race([
        this.runPipeline(input, onStep),
        timeoutPromise
      ]);
    } catch (error: any) {
      const errorMsg = error.message || "Unknown error";
      console.error(`❌ Pipeline error: ${errorMsg}`);
      return {
        status: "error",
        error: errorMsg,
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
   * 管线执行
   */
  private async runPipeline(input: AgentInput, onStep?: (event: AgentStepEvent) => void): Promise<AgentOutput> {
    const startTime = Date.now();
    const steps: string[] = [];
    const stepDetails: PipelineStepDetail[] = [];
    let totalTokens = 0;
    let stepCounter = 0;

    console.log(`\n🎬 Paparazzi V3 Pipeline starting for user: ${input.userId}`);
    console.log(`   📸 Photos: ${input.photos.length}`);

    this.photos = input.photos;

    onStep?.({
      type: 'agent_start',
      step: ++stepCounter,
      message: `🎬 开始分析 ${input.photos.length} 张照片...`,
      timestamp: Date.now()
    });

    try {
      // ==================== Step 1: ImageAnalyzer (Gemini VLM) ====================
      const step1Start = Date.now();
      onStep?.({
        type: 'tool_start',
        step: ++stepCounter,
        tool: 'image_analyzer',
        message: '📸 VLM 分析照片...',
        timestamp: Date.now()
      });

      const imageAnalysis = await this.step1_ImageAnalyzer();
      const step1Time = Date.now() - step1Start;
      steps.push('image_analyzer');
      stepDetails.push({
        step: 'image_analyzer',
        model: 'gemini-2.0-flash',
        startTime: step1Start,
        durationMs: step1Time,
        inputTokens: 0,
        outputTokens: 0,
        input: { photoCount: input.photos.length },
        output: imageAnalysis
      });

      console.log(`  ✅ Step 1 ImageAnalyzer: ${(step1Time / 1000).toFixed(2)}s`);
      onStep?.({
        type: 'tool_done',
        step: ++stepCounter,
        tool: 'image_analyzer',
        message: `✅ 照片分析完成`,
        timestamp: Date.now(),
        durationMs: step1Time
      });

      // ==================== Step 2: UserProfile + Memory + Relationships ====================
      const step2Start = Date.now();
      onStep?.({
        type: 'tool_start',
        step: ++stepCounter,
        tool: 'user_profile',
        message: '👤 加载画像 + 记忆检索 + 关系图谱...',
        timestamp: Date.now()
      });

      const userProfile = await this.step2_UserProfile(input.userId, imageAnalysis);
      const step2Time = Date.now() - step2Start;
      steps.push('user_profile');
      stepDetails.push({
        step: 'user_profile',
        model: 'none',
        startTime: step2Start,
        durationMs: step2Time,
        inputTokens: 0,
        outputTokens: 0,
        input: { userId: input.userId },
        output: {
          hasProfile: !!userProfile.persona_raw,
          hasMemory: (userProfile.memory_context?.total_matches || 0) > 0,
          memoryPaths: userProfile.memory_context?.active_paths || [],
          hasRelationships: userProfile.relationship_context?.has_relationships || false,
          relationshipCount: userProfile.relationship_context?.matched_relationships?.length || 0
        }
      });

      const memoryInfo = userProfile.memory_context?.total_matches
        ? ` (${userProfile.memory_context.total_matches}条记忆)`
        : '';
      const relInfo = userProfile.relationship_context?.has_relationships
        ? ' + 关系匹配'
        : '';
      console.log(`  ✅ Step 2 UserProfile: ${(step2Time / 1000).toFixed(2)}s${memoryInfo}${relInfo}`);
      onStep?.({
        type: 'tool_done',
        step: ++stepCounter,
        tool: 'user_profile',
        message: `✅ 画像已加载${memoryInfo}${relInfo}`,
        timestamp: Date.now(),
        durationMs: step2Time
      });

      // ==================== Step 3: RouterAgent (Claude Haiku) ====================
      const step3Start = Date.now();
      onStep?.({
        type: 'tool_start',
        step: ++stepCounter,
        tool: 'router_agent',
        message: '🧠 Brian 在规划分析策略...',
        timestamp: Date.now()
      });

      const { toolCalls, routerTokens } = await this.step3_RouterAgent(imageAnalysis, userProfile);
      const step3Time = Date.now() - step3Start;
      totalTokens += routerTokens;
      steps.push('router_agent');
      stepDetails.push({
        step: 'router_agent',
        model: promptConfigManager.getPipelineConfig().routerModel || 'claude-haiku-4-5-20251001',
        startTime: step3Start,
        durationMs: step3Time,
        inputTokens: routerTokens,
        outputTokens: 0,
        input: { imageAnalysis, userProfile },
        output: { toolCalls }
      });

      console.log(`  ✅ Step 3 RouterAgent: ${(step3Time / 1000).toFixed(2)}s → [${toolCalls.join(', ')}]`);
      onStep?.({
        type: 'tool_done',
        step: ++stepCounter,
        tool: 'router_agent',
        message: `✅ 规划完成: ${toolCalls.join(', ')}`,
        timestamp: Date.now(),
        durationMs: step3Time
      });

      // ==================== Step 4: Experts (Claude Sonnet, 并行) ====================
      const step4Start = Date.now();

      // 每个专家的 tool_start 事件
      for (const tool of toolCalls) {
        onStep?.({
          type: 'tool_start',
          step: ++stepCounter,
          tool,
          message: `🔬 ${this.getExpertDisplayName(tool)} 分析中...`,
          timestamp: Date.now()
        });
      }

      const { expertResults, expertTokens } = await this.step4_Experts(toolCalls, imageAnalysis, userProfile);
      const step4Time = Date.now() - step4Start;
      totalTokens += expertTokens;

      for (const tool of toolCalls) {
        steps.push(tool);
        onStep?.({
          type: 'tool_done',
          step: ++stepCounter,
          tool,
          message: `✅ ${this.getExpertDisplayName(tool)} 分析完成`,
          timestamp: Date.now(),
          durationMs: step4Time
        });
      }

      stepDetails.push({
        step: 'experts_parallel',
        model: promptConfigManager.getPipelineConfig().expertModel || 'claude-sonnet-4-20250514',
        startTime: step4Start,
        durationMs: step4Time,
        inputTokens: expertTokens,
        outputTokens: 0,
        input: { toolCalls },
        output: expertResults
      });

      console.log(`  ✅ Step 4 Experts (${toolCalls.length}x parallel): ${(step4Time / 1000).toFixed(2)}s`);

      // ==================== Step 5: CopyGenerator (Claude Sonnet agentic) ====================
      const step5Start = Date.now();
      onStep?.({
        type: 'tool_start',
        step: ++stepCounter,
        tool: 'copy_generator',
        message: '✍️ 正在生成文案...',
        timestamp: Date.now()
      });

      const { candidates, copyTokens } = await this.step5_CopyGenerator(
        imageAnalysis, userProfile, expertResults
      );
      const step5Time = Date.now() - step5Start;
      totalTokens += copyTokens;
      steps.push('copy_generator');
      stepDetails.push({
        step: 'copy_generator',
        model: promptConfigManager.getPipelineConfig().expertModel || 'claude-sonnet-4-20250514',
        startTime: step5Start,
        durationMs: step5Time,
        inputTokens: copyTokens,
        outputTokens: 0,
        input: { expertResults },
        output: candidates
      });

      console.log(`  ✅ Step 5 CopyGenerator: ${(step5Time / 1000).toFixed(2)}s → ${candidates.length} candidates`);
      onStep?.({
        type: 'tool_done',
        step: ++stepCounter,
        tool: 'copy_generator',
        message: `✅ 生成了 ${candidates.length} 条文案`,
        timestamp: Date.now(),
        durationMs: step5Time
      });

      // ==================== 输出适配 ====================
      const totalTime = Date.now() - startTime;
      console.log(`\n🎉 Pipeline complete in ${(totalTime / 1000).toFixed(2)}s, ${totalTokens} tokens`);

      onStep?.({
        type: 'agent_complete',
        step: ++stepCounter,
        message: `🎉 文案生成完成！`,
        timestamp: Date.now(),
        durationMs: totalTime
      });

      return this.adaptToAgentOutput(
        candidates,
        imageAnalysis,
        userProfile,
        expertResults,
        steps,
        stepDetails,
        totalTokens,
        startTime
      );

    } catch (error) {
      const elapsed = Date.now() - startTime;
      console.error(`❌ Pipeline error after ${(elapsed / 1000).toFixed(2)}s:`, error);
      return {
        status: "error",
        error: error instanceof Error ? error.message : "Pipeline failed",
        debug: {
          agentSteps: steps,
          stepDetails: stepDetails as any,
          totalTokens,
          totalLatencyMs: elapsed,
          agentTurns: steps.length
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
    if (confirmed) {
      console.log(`📤 Publishing story: ${storyId}`);
      return {
        success: true,
        message: "已发布！坐等朋友们的反应吧 👀"
      };
    } else {
      return {
        success: true,
        message: feedback
          ? `收到反馈，正在调整: ${feedback}`
          : "好的，换一个角度重新生成..."
      };
    }
  }

  // ==================== Step 实现 ====================

  /**
   * Step 1: ImageAnalyzer — Gemini VLM
   * 复用现有 toolHandlers.analyzePhotos()，适配为归档格式
   */
  private async step1_ImageAnalyzer(): Promise<PaparazziImageAnalysis> {
    const images = this.photos.map(p => ({
      base64: p.base64,
      mimeType: p.mimeType || "image/jpeg",
      exif: p.exif
    }));

    const exifContext = this.buildExifContext(this.photos);

    const result = await this.toolHandlers.analyzePhotos({
      images,
      timeRange: "今日",
      exifContext
    });

    const raw = JSON.parse(result.content[0].text);
    return this.parseToArchiveFormat(raw);
  }

  /**
   * Step 2: UserProfile — 数据查询
   */
  private async step2_UserProfile(
    userId: string,
    imageAnalysis: PaparazziImageAnalysis
  ): Promise<PaparazziUserProfile> {
    // 构建 4-Path 查询条件 (基于 Step 1 图像分析结果)
    const photoQuery = {
      entities: [
        ...imageAnalysis.brands,
        ...(imageAnalysis.clothing?.items || []),
        ...imageAnalysis.scene.visual_clues.slice(0, 5)
      ].filter(Boolean),
      people: [] as string[],  // New VLM schema: relationship matching via persona fallback
      location: imageAnalysis.scene.location_detected !== '未知'
        ? imageAnalysis.scene.location_detected
        : undefined,
      emotion: imageAnalysis.people.emotions?.[0] || undefined
    };

    // 并行执行 3 个数据查询 (无 LLM 消耗)
    const [personaText, personaSummary, memoryResult] = await Promise.all([
      personaSummaryService.getPersonaContext(userId),
      personaSummaryService.getPersonaSummary(userId).catch(() => null),
      userMemoryService.retrieve4Path(userId, photoQuery, 3).catch(() => null)
    ]);

    // 解析画像
    const profile = this.parsePersonaToProfile(personaText);

    // 构建记忆上下文
    if (memoryResult) {
      const topAngles = (memoryResult.top_narrative_angles || []).map((a: any) => ({
        angle_type: a.angle_type,
        angle_name: a.angle_name,
        confidence: a.confidence,
        description: a.description,
        matched_items: a.matched_items,
        memory_date: a.memory?.date,
        memory_content: a.memory?.content?.substring(0, 200)
      }));

      const activePaths: string[] = [];
      if (memoryResult.path_a_entity?.length > 0) activePaths.push('entity');
      if (memoryResult.path_b_emotion?.length > 0) activePaths.push('emotion');
      if (memoryResult.path_c_location?.length > 0) activePaths.push('location');
      if (memoryResult.path_d_person?.length > 0) activePaths.push('person');

      profile.memory_context = {
        top_angles: topAngles,
        total_matches:
          (memoryResult.path_a_entity?.length || 0) +
          (memoryResult.path_b_emotion?.length || 0) +
          (memoryResult.path_c_location?.length || 0) +
          (memoryResult.path_d_person?.length || 0),
        active_paths: activePaths
      };
    }

    // 构建关系上下文
    if (personaSummary?.relationshipMap?.length) {
      const detectedPeople: string[] = [];  // New VLM schema: no named people extraction
      const matched = personaSummary.relationshipMap
        .filter((r: any) =>
          detectedPeople.some((dp: string) =>
            r.person?.includes(dp) || dp.includes(r.person || '') ||
            (r.nickname && dp.includes(r.nickname))
          )
        )
        .map((r: any) => ({
          person: r.person,
          role: r.role,
          nickname: r.nickname,
          closeness_level: r.closenessLevel,
          trend: r.trend,
          shared_experiences: (r.sharedExperiences || []).slice(0, 3),
          first_seen: r.firstSeen,
          last_seen: r.lastSeen
        }));

      // 如果无精确匹配但有多人，回退到亲密关系 top 3
      const finalRelationships = matched.length > 0
        ? matched
        : (imageAnalysis.people.count && imageAnalysis.people.count > 1)
          ? personaSummary.relationshipMap
              .filter((r: any) => r.closenessLevel === '亲密' || r.frequencyLevel === '经常')
              .slice(0, 3)
              .map((r: any) => ({
                person: r.person,
                role: r.role,
                nickname: r.nickname,
                closeness_level: r.closenessLevel,
                trend: r.trend,
                shared_experiences: (r.sharedExperiences || []).slice(0, 3),
                first_seen: r.firstSeen,
                last_seen: r.lastSeen
              }))
          : [];

      const relevantKeyEvents = (personaSummary.keyEvents || []).slice(0, 5).map((e: any) => ({
        date: e.date,
        event: e.event,
        significance: e.significance
      }));

      profile.relationship_context = {
        matched_relationships: finalRelationships,
        relevant_key_events: relevantKeyEvents,
        has_relationships: finalRelationships.length > 0
      };
    }

    return profile;
  }

  /**
   * Step 3: RouterAgent — Claude Haiku
   */
  private async step3_RouterAgent(
    imageAnalysis: PaparazziImageAnalysis,
    userProfile: PaparazziUserProfile
  ): Promise<{ toolCalls: string[]; routerTokens: number }> {
    const config = promptConfigManager.getPipelineConfig();
    const systemPrompt = promptConfigManager.getPipelinePrompt('router_agent');

    const promptParts = [`## 视觉描述
${JSON.stringify(imageAnalysis, null, 2)}

## 用户画像
${JSON.stringify({
  age: userProfile.age,
  gender: userProfile.gender,
  interests: userProfile.interests,
  typical_brands: userProfile.typical_brands,
  consumption_level: userProfile.consumption_level
}, null, 2)}`];

    if (userProfile.memory_context && userProfile.memory_context.total_matches > 0) {
      promptParts.push(`## 相关历史记忆
${JSON.stringify(userProfile.memory_context.top_angles.slice(0, 3), null, 2)}`);
    }

    if (userProfile.relationship_context?.has_relationships) {
      promptParts.push(`## 人物关系
${JSON.stringify(userProfile.relationship_context.matched_relationships.slice(0, 3), null, 2)}`);
    }

    promptParts.push('请规划需要启用哪些分析角度。');
    const userPrompt = promptParts.join('\n\n');

    const response = await this.client.messages.create({
      model: config.routerModel || 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    try {
      // 提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // 支持新格式 experts: ["vibe_expert"] 和旧格式 tool_calls: [{tool: "vibe_expert"}]
        let toolCalls: string[];
        if (parsed.experts && Array.isArray(parsed.experts)) {
          toolCalls = parsed.experts.filter(Boolean);
        } else {
          toolCalls = (parsed.tool_calls || []).map((t: any) => t.tool).filter(Boolean);
        }
        // 确保至少有一个专家
        if (toolCalls.length === 0) {
          toolCalls = ['vibe_expert', 'flex_expert'];
        }
        return { toolCalls, routerTokens: tokens };
      }
    } catch (e) {
      console.warn('  ⚠️ RouterAgent JSON parse failed, using defaults');
    }

    // 默认：vibe_expert + flex_expert
    return { toolCalls: ['vibe_expert', 'flex_expert'], routerTokens: tokens };
  }

  /**
   * Step 4: Experts — Claude Sonnet 并行
   */
  private async step4_Experts(
    toolCalls: string[],
    imageAnalysis: PaparazziImageAnalysis,
    userProfile: PaparazziUserProfile
  ): Promise<{ expertResults: ExpertResults; expertTokens: number }> {
    const config = promptConfigManager.getPipelineConfig();
    let totalTokens = 0;

    const expertPromises = toolCalls.map(async (tool) => {
      const systemPrompt = promptConfigManager.getPipelinePrompt(tool);
      const promptParts = [`## 视觉描述
${JSON.stringify(imageAnalysis, null, 2)}

## 用户画像
${JSON.stringify({
  age: userProfile.age,
  gender: userProfile.gender,
  interests: userProfile.interests,
  typical_brands: userProfile.typical_brands,
  personality: userProfile.personality,
  consumption_level: userProfile.consumption_level
}, null, 2)}`];

      // 注入记忆上下文
      if (userProfile.memory_context && userProfile.memory_context.total_matches > 0) {
        promptParts.push(`## 相关历史记忆（从用户相册记忆中检索到的关联事件）
${userProfile.memory_context.top_angles.map(a =>
  `- [${a.angle_type}] ${a.memory_content || a.description} (${a.memory_date || '未知时间'}, 置信度: ${a.confidence})`
).join('\n')}`);
      }

      // 注入关系上下文
      if (userProfile.relationship_context?.has_relationships) {
        promptParts.push(`## 照片中人物的关系信息
${userProfile.relationship_context.matched_relationships.map(r =>
  `- ${r.person}（${r.role}，${r.closeness_level}，趋势: ${r.trend}）共同经历: ${r.shared_experiences.join('、')}`
).join('\n')}`);
      }

      promptParts.push('请开始分析。');
      const userPrompt = promptParts.join('\n\n');

      const response = await this.client.messages.create({
        model: config.expertModel || 'claude-sonnet-4-20250514',
        max_tokens: config.maxTokens || 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const text = response.content[0].type === 'text' ? response.content[0].text : '';

      try {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return { tool, result: JSON.parse(jsonMatch[0]) };
        }
      } catch {}

      return { tool, result: { raw: text } };
    });

    const results = await Promise.all(expertPromises);

    const expertResults: ExpertResults = {};
    for (const { tool, result } of results) {
      if (tool === 'flex_expert') expertResults.flex = result as { intents: FlexIntent[] };
      else if (tool === 'vibe_expert') expertResults.vibe = result as { intents: VibeIntent[] };
      else if (tool === 'gossip_expert') expertResults.gossip = result as { intents: GossipIntent[] };
    }

    return { expertResults, expertTokens: totalTokens };
  }

  /**
   * Step 5: CopyGenerator — Claude Sonnet per-intent
   * 为每个 expert intent 独立生成一条 Gen Z 英文 caption
   */
  private async step5_CopyGenerator(
    imageAnalysis: PaparazziImageAnalysis,
    userProfile: PaparazziUserProfile,
    expertResults: ExpertResults
  ): Promise<{ candidates: CopyCandidate[]; copyTokens: number }> {
    const config = promptConfigManager.getPipelineConfig();
    const systemPrompt = promptConfigManager.getPipelinePrompt('copy_generator');
    let totalTokens = 0;

    // 1. Collect all intents from all experts
    const allIntents: Array<{ intent: ExpertIntent; source: string }> = [];

    if (expertResults.flex?.intents) {
      for (const intent of expertResults.flex.intents) {
        allIntents.push({ intent, source: 'flex' });
      }
    }
    if (expertResults.vibe?.intents) {
      for (const intent of expertResults.vibe.intents) {
        allIntents.push({ intent, source: 'vibe' });
      }
    }
    if (expertResults.gossip?.intents) {
      for (const intent of expertResults.gossip.intents) {
        allIntents.push({ intent, source: 'gossip' });
      }
    }

    // Fallback: if no intents collected, create a generic one with raw context
    if (allIntents.length === 0) {
      const rawSummary = imageAnalysis.raw?.analysis?.summary
        || imageAnalysis.summary
        || '日常记录';
      allIntents.push({
        intent: { record_type: '日常', confidence: 0.4, core_narrative: rawSummary },
        source: 'default'
      });
    }

    // 2. For each intent, make a single Claude call
    const candidates: CopyCandidate[] = [];

    for (const { intent, source } of allIntents) {
      const userPrompt = this.buildPerIntentCopyPrompt(intent, source, imageAnalysis, expertResults, userProfile);

      try {
        const response = await this.client.messages.create({
          model: config.expertModel || 'claude-sonnet-4-20250514',
          max_tokens: 256,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        });

        totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
        const text = response.content[0].type === 'text' ? response.content[0].text : '';
        const caption = text.trim();

        if (caption) {
          candidates.push({
            copy: caption,
            intent_type: intent.record_type,
            intent: intent
          });
          console.log(`     📝 CopyGenerator [${intent.record_type}]: "${caption.substring(0, 50)}"`);
        }
      } catch (e) {
        console.warn(`     ⚠️ CopyGenerator failed for intent ${intent.record_type}:`, e);
      }
    }

    // Fallback if no candidates generated
    if (candidates.length === 0) {
      candidates.push({
        copy: 'Living the moment.',
        intent_type: '日常',
        intent: { record_type: '日常', confidence: 0.5, core_narrative: '日常记录' }
      });
    }

    return { candidates, copyTokens: totalTokens };
  }

  // ==================== 工具方法 ====================

  /**
   * 构建单个 intent 的 CopyGenerator user prompt
   */
  private buildPerIntentCopyPrompt(
    intent: ExpertIntent,
    source: string,
    imageAnalysis: PaparazziImageAnalysis,
    expertResults: ExpertResults,
    userProfile: PaparazziUserProfile
  ): string {
    const parts: string[] = [];

    parts.push(`## Intent Type\n${intent.record_type}`);
    parts.push(`\n## Evidence from Image\n${JSON.stringify(imageAnalysis, null, 2)}`);

    // 注入用户画像上下文，让文案更贴合用户人设
    const profileSnippet: Record<string, any> = {};
    if (userProfile.gender) profileSnippet.gender = userProfile.gender;
    if (userProfile.age) profileSnippet.age = userProfile.age;
    if (userProfile.interests?.length) profileSnippet.interests = userProfile.interests;
    if (userProfile.personality) profileSnippet.personality = userProfile.personality;
    if (userProfile.consumption_level) profileSnippet.consumption_level = userProfile.consumption_level;
    if (userProfile.typical_brands?.length) profileSnippet.typical_brands = userProfile.typical_brands;

    if (Object.keys(profileSnippet).length > 0) {
      parts.push(`\n## User Profile (tailor the caption to this person's identity)\n${JSON.stringify(profileSnippet, null, 2)}`);
    }

    // Get the full expert analysis for this source
    let expertAnalysis: any = null;
    if (source === 'flex' && expertResults.flex) expertAnalysis = expertResults.flex;
    else if (source === 'vibe' && expertResults.vibe) expertAnalysis = expertResults.vibe;
    else if (source === 'gossip' && expertResults.gossip) expertAnalysis = expertResults.gossip;

    if (expertAnalysis) {
      parts.push(`\n## Expert Analysis\n${JSON.stringify(expertAnalysis, null, 2)}`);
    }

    // 当 source 为 default（无专家 intent）时，注入 raw 照片描述作为补充上下文
    if (source === 'default' && imageAnalysis.raw?.analysis) {
      const rawAnalysis = imageAnalysis.raw.analysis;
      parts.push(`\n## Photo Description (raw)\nSummary: ${rawAnalysis.summary || ''}`);
      if (rawAnalysis.protagonist?.description) {
        parts.push(`Protagonist: ${rawAnalysis.protagonist.description}`);
      }
      const photo = rawAnalysis.photos?.[0];
      if (photo) {
        if (photo.setting) parts.push(`Setting: ${photo.setting}`);
        if (photo.objects?.length) parts.push(`Objects: ${photo.objects.join(', ')}`);
        if (photo.activities?.length) parts.push(`Activities: ${photo.activities.join(', ')}`);
      }
    }

    parts.push(`\n## Core Narrative\n${intent.core_narrative}`);
    parts.push(`\nGenerate a Gen Z style caption for this intent.`);

    return parts.join('\n');
  }


  // ==================== 格式转换 ====================

  /**
   * VLM 原始输出 → PaparazziImageAnalysis 格式
   * 兼容两种 VLM 输出格式：
   *   1) 扁平格式: { summary, mood, people: { count, ... }, scene: { ... } }
   *   2) Gemini 嵌套格式: { analysis: { protagonist, photos: [...], summary }, metadata }
   */
  private parseToArchiveFormat(raw: any): PaparazziImageAnalysis {
    // === 从 Gemini 嵌套格式中提取核心数据 ===
    const analysis = raw.analysis || {};
    const photos: any[] = analysis.photos || [];
    const primaryPhoto = photos[0] || {};
    const protagonist = analysis.protagonist || {};
    const protagonistDesc: string = protagonist.description || '';

    // 合并所有照片数据
    const allPeople = photos.flatMap((p: any) => p.people || []);
    const allObjects = photos.flatMap((p: any) => p.objects || []);
    const allActivities = photos.flatMap((p: any) => p.activities || []);

    // 从 protagonist 描述推断人物存在
    const hasProtagonist = protagonistDesc
      && !protagonistDesc.includes('无法识别')
      && !protagonistDesc.includes('未出现')
      && !protagonistDesc.includes('无人');
    const personCount = hasProtagonist
      ? Math.max(allPeople.length, 1)
      : allPeople.filter((p: string) => p !== '【主角】').length;

    // 从 protagonist 描述推断性别
    const inferredGenders: string[] = [];
    if (protagonistDesc.includes('男') || protagonistDesc.includes('他')) inferredGenders.push('male');
    if (protagonistDesc.includes('女') || protagonistDesc.includes('她')) inferredGenders.push('female');

    // 嵌套数据 fallback 链：优先用顶层字段，其次从 analysis/photos 提取
    const flatSummary = raw.summary || analysis.summary || primaryPhoto.setting || '照片分析';
    const flatMood = raw.mood || primaryPhoto.mood || '';
    const flatVibes = raw.vibes || (flatMood && flatMood !== '无法判断' ? [flatMood] : []);
    const flatSetting = primaryPhoto.setting || '';
    const flatObjects = raw.objects || allObjects;
    const flatActivities = raw.activities || allActivities;

    return {
      summary: flatSummary,
      mood: flatMood,
      vibes: flatVibes.length > 0 ? flatVibes : (raw.atmosphere ? [raw.atmosphere] : []),
      weather: {
        condition: raw.weather?.condition || null,
        rarity: raw.weather?.rarity || 'normal',
        visual_elements: raw.weather?.visual_elements || []
      },
      macro_event: {
        event_type: raw.macro_event?.event_type || '日常',
        activity: raw.macro_event?.activity || flatActivities.join(', ') || flatSetting || '日常活动',
        social_context: raw.macro_event?.social_context || (personCount === 0 ? '独自' : personCount === 1 ? '独自' : personCount === 2 ? '二人' : '群体')
      },
      brands: raw.brands || [],
      violations: raw.violations || [],
      people: {
        count: raw.people?.count ?? personCount,
        genders: raw.people?.genders || (inferredGenders.length > 0 ? inferredGenders : []),
        age_group: raw.people?.age_group || '未知',
        composition: raw.people?.composition || '未知',
        pose: raw.people?.pose || this.extractKeywordFromDesc(protagonistDesc, ['站立', '坐', '驾驶', '躺', '走']),
        gaze: raw.people?.gaze || '',
        facial_expression: raw.people?.facial_expression || flatMood || '',
        demeanor: raw.people?.demeanor || '',
        emotions: raw.people?.emotions || (flatMood && flatMood !== '无法判断' ? [flatMood] : []),
        actions: raw.people?.actions || flatActivities,
        body_display: {
          has_muscle: raw.people?.body_display?.has_muscle || false,
          has_skin_showcase: raw.people?.body_display?.has_skin_showcase || false,
          fitness_level: raw.people?.body_display?.fitness_level || 'unknown',
          body_type: raw.people?.body_display?.body_type || '未知',
          posture: raw.people?.body_display?.posture || this.extractKeywordFromDesc(protagonistDesc, ['站立', '坐着', '驾驶'])
        }
      },
      scene: {
        location_detected: raw.scene?.location_detected || flatSetting || '未知',
        location_type: raw.scene?.location_type || this.inferLocationType(flatSetting),
        visual_clues: raw.scene?.visual_clues || [
          ...flatObjects,
          ...(raw.colors || []),
          ...(raw.keyDetails || [])
        ].slice(0, 8),
        environment_details: raw.scene?.environment_details || []
      },
      clothing: {
        description: raw.clothing?.description || '',
        items: raw.clothing?.items || [],
        style: raw.clothing?.style || ''
      },
      story_hints: raw.story_hints || [],
      raw
    };
  }

  /**
   * 从场景描述推断室内/室外
   */
  private inferLocationType(setting: string): string {
    if (!setting) return '未知';
    if (/室内|办公|书房|卧室|客厅|厨房|家/.test(setting)) return '室内';
    if (/室外|户外|街道|公园|海边|山/.test(setting)) return '室外';
    if (/车|汽车|驾驶|座/.test(setting)) return '交通工具内';
    return '未知';
  }

  /**
   * 从描述文本中提取匹配的关键词
   */
  private extractKeywordFromDesc(desc: string, keywords: string[]): string {
    if (!desc) return '';
    for (const kw of keywords) {
      if (desc.includes(kw)) return kw;
    }
    return '';
  }

  /**
   * persona 文本 → 结构化 UserProfile
   */
  private parsePersonaToProfile(personaText: string): PaparazziUserProfile {
    // 尝试从文本中提取结构化信息
    const profile: PaparazziUserProfile = {
      persona_raw: personaText
    };

    if (!personaText || personaText === '暂无用户画像数据') {
      return profile;
    }

    // === Gender 提取：优先从"主人特征"行精确匹配，避免匹配到关系图谱中的其他人 ===
    const ownerLine = personaText.match(/\*{0,2}主人特征\*{0,2}[：:]\s*([^\n]+)/);
    if (ownerLine) {
      const ownerDesc = ownerLine[1];
      if (ownerDesc.includes('男')) profile.gender = '男';
      else if (ownerDesc.includes('女')) profile.gender = '女';
    }
    // 回退：从"身份"行匹配
    if (!profile.gender) {
      const identityLine = personaText.match(/\*{0,2}身份\*{0,2}[：:]\s*([^\n]+)/);
      if (identityLine) {
        const identityDesc = identityLine[1];
        if (identityDesc.includes('男')) profile.gender = '男';
        else if (identityDesc.includes('女')) profile.gender = '女';
      }
    }

    // === Age 提取：兼容 Markdown 格式 ===
    const ageMatch = personaText.match(/(?:\*{0,2}年龄\*{0,2}[：:]\s*)?(\d{1,2})\s*岁/);
    if (ageMatch) profile.age = parseInt(ageMatch[1]);

    // === 兴趣提取：兼容 **兴趣**: xxx 格式 ===
    const interestPatterns = /\*{0,2}(?:喜欢|兴趣|爱好)\*{0,2}[：:]\s*([^。\n]+)/g;
    const interests: string[] = [];
    let match;
    while ((match = interestPatterns.exec(personaText)) !== null) {
      interests.push(...match[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean));
    }
    if (interests.length > 0) profile.interests = interests;

    // === 性格提取 ===
    const personalityMatch = personaText.match(/\*{0,2}性格\*{0,2}[：:]\s*([^\n]+)/);
    if (personalityMatch) {
      profile.personality = personalityMatch[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    }

    // === 消费水平提取 ===
    const consumptionMatch = personaText.match(/\*{0,2}消费水平\*{0,2}[：:]\s*([^\n]+)/);
    if (consumptionMatch) {
      profile.consumption_level = consumptionMatch[1].trim();
    }

    // === 常用品牌提取 ===
    const brandsMatch = personaText.match(/\*{0,2}(?:常用品牌|典型品牌|品牌偏好)\*{0,2}[：:]\s*([^\n]+)/);
    if (brandsMatch) {
      profile.typical_brands = brandsMatch[1].split(/[,，、]/).map(s => s.trim()).filter(Boolean);
    }

    return profile;
  }

  /**
   * 推断社交上下文
   */
  private inferSocialContext(people: string[] | undefined): string {
    if (!people || people.length === 0) return '独自';
    if (people.length === 1) return '独自';
    if (people.length === 2) return '二人';
    return '群体';
  }

  /**
   * copy_candidates → AgentOutput (iOS 兼容)
   */
  private adaptToAgentOutput(
    candidates: CopyCandidate[],
    imageAnalysis: PaparazziImageAnalysis,
    userProfile: PaparazziUserProfile,
    expertResults: ExpertResults,
    steps: string[],
    stepDetails: PipelineStepDetail[],
    totalTokens: number,
    startTime: number
  ): AgentOutput {
    const primaryCopy = candidates[0];
    const totalTime = Date.now() - startTime;

    // 构建 Story (iOS 兼容)
    const story: Story = {
      id: `story_${Date.now()}`,
      title: this.extractTitle(primaryCopy, expertResults),
      body: primaryCopy.copy,
      angle: this.mapIntentToAngle(primaryCopy.intent_type),
      style: 'gossip',
      score: (primaryCopy.intent?.confidence || 0.5) * 10,
      expertScores: this.buildExpertScores(expertResults),
      createdAt: Date.now()
    };

    const output: AgentOutput = {
      status: 'pending_confirmation',
      story,
      storyPreview: {
        storyId: story.id,
        story,
        predictedEngagement: {
          likes: Math.round((primaryCopy.intent?.confidence || 0.5) * 40),
          comments: Math.round((primaryCopy.intent?.confidence || 0.5) * 20),
          likelyReactions: this.predictReactions(primaryCopy)
        },
        alternatives: candidates.slice(1).map((c, i) => ({
          id: `story_${Date.now()}_alt${i}`,
          title: this.extractTitle(c, expertResults),
          body: c.copy,
          angle: this.mapIntentToAngle(c.intent_type),
          style: 'gossip' as const,
          score: (c.intent?.confidence || 0.5) * 10,
          createdAt: Date.now()
        }))
      },
      engagementScore: (primaryCopy.intent?.confidence || 0.5) * 10,
      photoAnalysis: imageAnalysis.raw || imageAnalysis,
      debug: {
        agentSteps: steps,
        stepDetails: stepDetails.map(s => ({
          turn: steps.indexOf(s.step) + 1,
          tool: s.step,
          startTime: s.startTime,
          durationMs: s.durationMs,
          inputTokens: s.inputTokens,
          outputTokens: s.outputTokens,
          input: s.input,
          output: typeof s.output === 'string' ? s.output : JSON.stringify(s.output)
        })),
        totalTokens,
        totalLatencyMs: totalTime,
        agentTurns: steps.length
      }
    };

    // iOS expects these at root level
    (output as any).discoveryAngle = primaryCopy.intent_type;
    (output as any).expertScores = story.expertScores;
    (output as any).likelyReactions = this.predictReactions(primaryCopy);

    return output;
  }

  // ==================== 辅助方法 ====================

  /**
   * 从文案提取标题
   */
  private extractTitle(copy: CopyCandidate, expertResults: ExpertResults): string {
    // 尝试从 core_narrative 生成标题
    const narrative = copy.intent?.core_narrative
      || expertResults.flex?.intents?.[0]?.core_narrative;
    if (narrative) {
      if (narrative.length <= 12) return narrative;
      return narrative.substring(0, 10) + '...';
    }

    // 按意图类型映射
    const titleMap: Record<string, string> = {
      '炫耀': '今日高光',
      '氛围': '今日氛围',
      '八卦': '这是什么情况',
      '日常': '今日碎片'
    };
    return titleMap[copy.intent_type] || '今日快报';
  }

  /**
   * intent_type → Story.angle
   */
  private mapIntentToAngle(intentType: string): Story['angle'] {
    const map: Record<string, Story['angle']> = {
      '炫耀': 'hidden_flex',
      '八卦': 'share_value',
      '日常': 'emotion_peak'
    };
    return map[intentType] || 'share_value';
  }

  /**
   * 从专家结果构建 ExpertScores — 直接透传各专家的原始分析
   */
  private buildExpertScores(expertResults: ExpertResults): ExpertScores {
    const scores: ExpertScores = {};

    const flexIntent = expertResults.flex?.intents?.[0];
    if (flexIntent) {
      scores.flex = {
        category: flexIntent.analysis?.category || '',
        subcategory: flexIntent.analysis?.subcategory || '',
        dimension_score: flexIntent.analysis?.dimension_score || 0,
        confidence: flexIntent.confidence || 0,
        core_narrative: flexIntent.core_narrative || ''
      };
    }

    const vibeIntent = expertResults.vibe?.intents?.[0];
    if (vibeIntent) {
      scores.vibe = {
        vibe_type: vibeIntent.analysis?.vibe_type || '',
        emotional_tone: vibeIntent.analysis?.emotional_tone || '',
        strength: vibeIntent.analysis?.strength || 0,
        confidence: vibeIntent.confidence || 0,
        core_narrative: vibeIntent.core_narrative || ''
      };
    }

    const gossipIntent = expertResults.gossip?.intents?.[0];
    if (gossipIntent) {
      scores.gossip = {
        gossip_type: gossipIntent.analysis?.gossip_type || '',
        social_dynamics: gossipIntent.analysis?.social_dynamics || '',
        confidence: gossipIntent.confidence || 0,
        core_narrative: gossipIntent.core_narrative || ''
      };
    }

    return scores;
  }

  /**
   * 预测反应
   */
  private predictReactions(copy: CopyCandidate): string[] {
    if (copy.intent_type === '炫耀') {
      return ["slay", "fire 🔥", "goals"];
    } else if (copy.intent_type === '八卦') {
      return ["tea ☕", "spill", "no way"];
    } else if (copy.intent_type === '氛围') {
      return ["mood", "aesthetic", "feels"];
    }
    return ["nice", "love this", "cool"];
  }

  /**
   * 专家显示名
   */
  private getExpertDisplayName(tool: string): string {
    const names: Record<string, string> = {
      flex_expert: '炫耀分析',
      vibe_expert: '氛围分析',
      gossip_expert: '八卦分析'
    };
    return names[tool] || tool;
  }

  /**
   * 从照片 EXIF 构建上下文 (复用自 agent.ts)
   */
  private buildExifContext(photos: PhotoInput[]): string {
    const exifInfos: string[] = [];

    photos.forEach((photo, index) => {
      if (!photo.exif) return;
      const exif = photo.exif;
      const parts: string[] = [];

      if (exif.dateTime) parts.push(`拍摄时间: ${exif.dateTime}`);
      if (exif.locationName) parts.push(`地点: ${exif.locationName}`);
      else if (exif.latitude && exif.longitude) {
        parts.push(`GPS: ${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`);
      }
      if (exif.deviceModel) parts.push(`设备: ${exif.deviceModel}`);

      if (parts.length > 0) {
        exifInfos.push(`照片${index + 1}: ${parts.join(', ')}`);
      }
    });

    return exifInfos.length > 0
      ? `\n## 照片元数据\n${exifInfos.join('\n')}`
      : '';
  }
}
