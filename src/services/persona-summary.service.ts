/**
 * Persona Summary Service
 *
 * 基于历史记忆生成用户人设总结
 * 作为 Agent 的 KV Cache，减少每次检索开销
 */

import { MongoClient, Db } from 'mongodb';
import { userMemoryService } from './user-memory.service';
import Anthropic from '@anthropic-ai/sdk';

export interface RelationshipEntry {
  person: string;                 // 外貌特征描述
  role: string;                   // 关系角色
  nickname?: string;              // 推测称呼
  sharedExperiences: string[];    // 共同经历
  frequencyLevel: string;         // 出现频率
  closenessLevel: string;         // 亲密度
  trend: string;                  // 关系趋势
  firstSeen?: string;             // 最早出现时间
  lastSeen?: string;              // 最近出现时间
}

export interface PersonaSummary {
  userId: string;
  updatedAt: number;

  // 核心人设
  profile: {
    occupation: string;           // 职业
    interests: string[];          // 兴趣爱好
    lifestyle: string;            // 生活方式
    personality: string;          // 性格特点
  };

  // 情感状态
  emotional: {
    currentMood: string;          // 当前情绪基调
    emotionalPatterns: string[];  // 情绪模式
    relationships: string[];      // 重要关系
  };

  // 人物关系图谱
  relationshipMap: RelationshipEntry[];

  // 主人身份
  ownerIdentity?: {
    appearance: string;           // 主人外貌
    socialStyle: string;          // 社交风格
    innerCircle: string;          // 核心社交圈
  };

  // 重要事件
  keyEvents: Array<{
    date: string;
    event: string;
    significance: string;
  }>;

  // 常去地点
  frequentPlaces: string[];

  // 生活节奏
  routines: string[];

  // 一句话总结
  oneLiner: string;

  // 原始记忆统计
  memoryStats: {
    totalCount: number;
    dateRange: string;
    topEntities: string[];
  };
}

class PersonaSummaryService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private anthropic: Anthropic | null = null;
  // 安全修复：使用 Map 缓存每个用户的 persona，而不是单一变量
  private cachedSummaries = new Map<string, PersonaSummary>();
  private initPromise: Promise<void> | null = null;
  // 安全修复：使用 Map 跟踪每个用户的生成 Promise，防止竞态条件
  private generatingPromises = new Map<string, Promise<PersonaSummary | null>>();

  constructor() {
    // 懒初始化 - 不在构造函数中调用
  }

  /**
   * 确保服务已初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (this.anthropic && this.db) {
      return; // 已初始化
    }

    if (this.initPromise) {
      return this.initPromise; // 正在初始化中
    }

    this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    // 初始化 Anthropic
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey && !this.anthropic) {
      this.anthropic = new Anthropic({ apiKey });
      console.log('✅ PersonaSummaryService Anthropic initialized');
    }

    // 初始化 MongoDB
    const uri = process.env.MONGODB_URI;
    if (uri && !this.db) {
      try {
        this.client = new MongoClient(uri);
        await this.client.connect();
        this.db = this.client.db('pixelbeat');
        console.log('✅ PersonaSummaryService connected to MongoDB');
      } catch (error) {
        console.error('❌ PersonaSummaryService MongoDB error:', error);
      }
    }
  }

  /**
   * 获取人设总结（快速路径 - 优先返回缓存，不阻塞生成）
   */
  async getPersonaSummary(userId: string = 'default'): Promise<PersonaSummary | null> {
    // 1. 检查内存缓存（最快）- 使用 Map 按 userId 隔离
    const cached = this.cachedSummaries.get(userId);
    if (cached) {
      const age = Date.now() - cached.updatedAt;
      // 缓存 1 小时内有效
      if (age < 3600000) {
        console.log(`[PersonaSummary] Using cached summary for user: ${userId.substring(0, 12)}...`);
        return cached;
      }
      // 过期则删除
      this.cachedSummaries.delete(userId);
    }

    // 2. 尝试从 MongoDB 读取（稍慢但可接受）
    await this.ensureInitialized();

    if (this.db) {
      try {
        const stored = await this.db.collection('persona_summaries').findOne({ userId });
        if (stored) {
          const age = Date.now() - stored.updatedAt;
          // 数据库中的总结 24 小时内有效
          if (age < 86400000) {
            console.log(`[PersonaSummary] Using stored summary from MongoDB for user: ${userId.substring(0, 12)}...`);
            const summary = stored as unknown as PersonaSummary;
            this.cachedSummaries.set(userId, summary);
            return summary;
          }
        }
      } catch (error) {
        console.error('[PersonaSummary] MongoDB read error:', error);
      }
    }

    // 3. 没有缓存 - 返回 null，后台异步生成
    // 安全修复：使用 Map 跟踪每个用户的生成状态，防止竞态条件
    if (!this.generatingPromises.has(userId)) {
      console.log(`[PersonaSummary] No cache found for user: ${userId.substring(0, 12)}..., starting background generation...`);
      const promise = this.generatePersonaSummary(userId);
      this.generatingPromises.set(userId, promise);
      promise.finally(() => this.generatingPromises.delete(userId));
    }

    return null;
  }

  /**
   * 后台生成人设总结（不阻塞）
   * 安全修复：使用 Map 跟踪每个用户的生成状态，防止竞态条件
   */
  private async generateInBackground(userId: string): Promise<void> {
    // 检查是否已有该用户的生成任务在进行中
    if (this.generatingPromises.has(userId)) return;

    const promise = this.generatePersonaSummary(userId);
    this.generatingPromises.set(userId, promise);

    try {
      await promise;
    } catch (error) {
      console.error('[PersonaSummary] Background generation error:', error);
    } finally {
      this.generatingPromises.delete(userId);
    }
  }

  /**
   * 基于所有记忆生成人设总结
   */
  async generatePersonaSummary(userId: string = 'default'): Promise<PersonaSummary | null> {
    await this.ensureInitialized();

    if (!this.anthropic) {
      console.error('[PersonaSummary] Anthropic not initialized');
      return null;
    }

    // 从 MongoDB 加载该用户的记忆（而非全局 JSON 文件）
    const allMemories = await userMemoryService.getUserMemories(userId);
    const stats = await userMemoryService.getStats(userId);

    if (allMemories.length === 0) {
      console.warn(`[PersonaSummary] No memories found for user: ${userId.substring(0, 12)}...`);
      return null;
    }

    console.log(`[PersonaSummary] Generating for user: ${userId.substring(0, 12)}... with ${allMemories.length} memories`);

    // 采样记忆（避免 token 过多）
    const sampledMemories = this.sampleMemories(allMemories, 100);
    const memoriesText = sampledMemories.map(m => {
      let line = `[${m.date}] ${m.content}`;
      if (m.emotion) line += ` (情绪: ${m.emotion})`;
      if (m.location) line += ` @${m.location}`;
      // 包含人物关系信息
      if ((m as any).peopleDetails && (m as any).peopleDetails.length > 0) {
        const pd = (m as any).peopleDetails;
        const peopleStr = pd.map((p: any) => `${p.appearance}(${p.role},${p.closeness}): ${p.interaction}`).join('; ');
        line += ` [人物: ${peopleStr}]`;
      } else if (m.people) {
        line += ` [人物: ${m.people}]`;
      }
      return line;
    }).join('\n');

    // 提取人际关系观察
    const relationshipMemories = allMemories.filter((m: any) => m.type === 'relationship_observation');
    const relationshipText = relationshipMemories.length > 0
      ? '\n## 人际关系观察\n' + relationshipMemories.map((m: any) => `[${m.date}] ${m.content}`).join('\n')
      : '';

    const prompt = `基于以下用户的历史记忆，生成一份人设总结。

## 历史记忆（共${allMemories.length}条，以下是采样）
${memoriesText}
${relationshipText}

## 统计信息
- 总记忆数: ${stats.total}
- 地点数: ${stats.topLocations.length}
- 实体数: ${stats.topEntities.length}

请分析这些记忆，重点关注人物关系，生成结构化的人设总结。输出 JSON 格式：

{
  "profile": {
    "occupation": "推测的职业或身份",
    "interests": ["兴趣1", "兴趣2", "兴趣3"],
    "lifestyle": "生活方式描述",
    "personality": "性格特点"
  },
  "emotional": {
    "currentMood": "整体情绪基调",
    "emotionalPatterns": ["情绪模式1", "情绪模式2"],
    "relationships": ["重要关系1", "重要关系2"]
  },
  "relationshipMap": [
    {
      "person": "外貌特征描述（用于识别）",
      "role": "关系角色（朋友/家人/伴侣/同事等）",
      "nickname": "如果能推测出称呼",
      "sharedExperiences": ["一起做过的事1", "一起做过的事2"],
      "frequencyLevel": "出现频率（经常/偶尔/很少）",
      "closenessLevel": "亲密度（亲密/熟悉/一般）",
      "trend": "关系趋势（越来越近/稳定/渐行渐远/新认识）",
      "firstSeen": "最早出现的大概时间",
      "lastSeen": "最近出现的大概时间"
    }
  ],
  "ownerIdentity": {
    "appearance": "主人的外貌特征",
    "socialStyle": "社交风格（如：喜欢小聚、经常独处、社交活跃等）",
    "innerCircle": "核心社交圈描述"
  },
  "keyEvents": [
    {"date": "日期", "event": "事件描述", "significance": "重要性"}
  ],
  "frequentPlaces": ["常去地点1", "常去地点2"],
  "routines": ["生活习惯1", "生活习惯2"],
  "oneLiner": "用一句话概括这个人"
}`;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('[PersonaSummary] Failed to parse response');
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const summary: PersonaSummary = {
        userId,
        updatedAt: Date.now(),
        profile: parsed.profile || {},
        emotional: parsed.emotional || {},
        relationshipMap: (parsed.relationshipMap || []).map((r: any) => ({
          person: r.person || '',
          role: r.role || '',
          nickname: r.nickname,
          sharedExperiences: r.sharedExperiences || [],
          frequencyLevel: r.frequencyLevel || '偶尔',
          closenessLevel: r.closenessLevel || '一般',
          trend: r.trend || '稳定',
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen
        })),
        ownerIdentity: parsed.ownerIdentity ? {
          appearance: parsed.ownerIdentity.appearance || '',
          socialStyle: parsed.ownerIdentity.socialStyle || '',
          innerCircle: parsed.ownerIdentity.innerCircle || ''
        } : undefined,
        keyEvents: parsed.keyEvents || [],
        frequentPlaces: parsed.frequentPlaces || [],
        routines: parsed.routines || [],
        oneLiner: parsed.oneLiner || '',
        memoryStats: {
          totalCount: stats.total,
          dateRange: this.getDateRange(allMemories),
          topEntities: stats.topEntities?.slice(0, 10) || []
        }
      };

      // 保存到 MongoDB
      if (this.db) {
        try {
          await this.db.collection('persona_summaries').updateOne(
            { userId },
            { $set: summary },
            { upsert: true }
          );
          console.log(`[PersonaSummary] Saved to MongoDB for user: ${userId.substring(0, 12)}...`);
        } catch (error) {
          console.error('[PersonaSummary] MongoDB save error:', error);
        }
      }

      // 更新用户缓存
      this.cachedSummaries.set(userId, summary);

      console.log(`[PersonaSummary] Generated successfully for user: ${userId.substring(0, 12)}...`);
      return summary;

    } catch (error) {
      console.error('[PersonaSummary] Generation error:', error);
      return null;
    }
  }

  /**
   * 获取人设总结的简短版本（用于 Agent 上下文）
   * 快速返回 - 如果没有缓存则返回基础信息
   * 每个用户独立，基于 userId 隔离
   */
  async getPersonaContext(userId: string = 'default'): Promise<string> {
    const summary = await this.getPersonaSummary(userId);

    if (!summary) {
      // 没有人设缓存时，从 MongoDB 获取该用户的记忆统计
      const stats = await userMemoryService.getStats(userId);

      if (stats.total === 0) {
        return '暂无用户画像数据（请先添加一些记忆）';
      }

      // 返回简单的统计信息
      const topLocations = stats.topLocations.slice(0, 3).map(([loc]) => loc);
      const topEntities = stats.topEntities.slice(0, 5);

      return `## 用户画像（基础版）
**记忆数量**: ${stats.total} 条
**常见地点**: ${topLocations.join('、') || '未知'}
**常见标签**: ${topEntities.join('、') || '未知'}

（完整人设正在后台生成中...）`;
    }

    // 构建人物关系部分
    let relationshipSection = '';
    if (summary.relationshipMap && summary.relationshipMap.length > 0) {
      const relLines = summary.relationshipMap.map(r => {
        let line = `- ${r.person}（${r.role}`;
        if (r.nickname) line += `，称呼: ${r.nickname}`;
        line += `，亲密度: ${r.closenessLevel}，趋势: ${r.trend}）`;
        if (r.sharedExperiences.length > 0) {
          line += `\n  共同经历: ${r.sharedExperiences.join('、')}`;
        }
        return line;
      });
      relationshipSection = `\n**人物关系图谱**:\n${relLines.join('\n')}`;
    }

    let ownerSection = '';
    if (summary.ownerIdentity) {
      ownerSection = `\n**主人特征**: ${summary.ownerIdentity.appearance}
**社交风格**: ${summary.ownerIdentity.socialStyle}
**核心社交圈**: ${summary.ownerIdentity.innerCircle}`;
    }

    return `## 用户画像
**身份**: ${summary.profile.occupation}
**兴趣**: ${summary.profile.interests.join('、')}
**性格**: ${summary.profile.personality}
**生活方式**: ${summary.profile.lifestyle}

**情绪基调**: ${summary.emotional.currentMood}
**重要关系**: ${summary.emotional.relationships.join('、')}
${ownerSection}
${relationshipSection}

**常去地点**: ${summary.frequentPlaces.join('、')}
**生活习惯**: ${summary.routines.join('、')}

**一句话**: ${summary.oneLiner}

**重要事件**:
${summary.keyEvents.slice(0, 5).map(e => `- [${e.date}] ${e.event}`).join('\n')}`;
  }

  /**
   * 采样记忆
   */
  private sampleMemories(memories: any[], count: number): any[] {
    if (memories.length <= count) return memories;

    // 按时间排序，均匀采样
    const sorted = [...memories].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    const step = Math.floor(sorted.length / count);
    const sampled: any[] = [];

    for (let i = 0; i < sorted.length && sampled.length < count; i += step) {
      sampled.push(sorted[i]);
    }

    return sampled;
  }

  /**
   * 获取日期范围
   */
  private getDateRange(memories: any[]): string {
    if (memories.length === 0) return 'N/A';

    const dates = memories
      .map(m => new Date(m.date).getTime())
      .filter(d => !isNaN(d))
      .sort((a, b) => a - b);

    if (dates.length === 0) return 'N/A';

    const start = new Date(dates[0]).toISOString().split('T')[0];
    const end = new Date(dates[dates.length - 1]).toISOString().split('T')[0];

    return `${start} ~ ${end}`;
  }

  /**
   * 强制刷新人设总结
   */
  async refreshPersonaSummary(userId: string = 'default'): Promise<PersonaSummary | null> {
    this.cachedSummaries.delete(userId);
    if (this.db) {
      await this.db.collection('persona_summaries').deleteOne({ userId });
    }
    return this.generatePersonaSummary(userId);
  }

  /**
   * 从 iOS 格式更新人设（用户手动编辑后覆盖）
   */
  async updatePersonaFromIOS(userId: string, iosPersona: any): Promise<boolean> {
    await this.ensureInitialized();

    if (!this.db) {
      console.error('[PersonaSummary] MongoDB not initialized for update');
      return false;
    }

    try {
      // Convert iOS format to internal format
      const summary: PersonaSummary = {
        userId,
        updatedAt: Date.now(),
        profile: {
          occupation: iosPersona.lifestyle?.occupation || '',
          interests: iosPersona.preferences?.interests || [],
          lifestyle: iosPersona.lifestyle?.daily_patterns?.join(', ') || '',
          personality: iosPersona.personality?.traits?.join(', ') || ''
        },
        emotional: {
          currentMood: iosPersona.personality?.communication_style || '',
          emotionalPatterns: [],
          relationships: iosPersona.social?.relationships || []
        },
        relationshipMap: [],
        keyEvents: (iosPersona.recent?.events || []).map((e: any) => ({
          date: e.date || '',
          event: e.description || '',
          significance: ''
        })),
        frequentPlaces: iosPersona.lifestyle?.frequent_locations || [],
        routines: iosPersona.lifestyle?.daily_patterns || [],
        oneLiner: iosPersona.summary || '',
        memoryStats: {
          totalCount: iosPersona.recent?.total_photos_analyzed || 0,
          dateRange: '',
          topEntities: []
        }
      };

      // Save to MongoDB
      await this.db.collection('persona_summaries').updateOne(
        { userId },
        { $set: summary },
        { upsert: true }
      );

      // Update per-user cache
      this.cachedSummaries.set(userId, summary);

      console.log(`[PersonaSummary] Updated persona for user: ${userId.substring(0, 12)}...`);
      return true;

    } catch (error) {
      console.error('[PersonaSummary] Update error:', error);
      return false;
    }
  }

  /**
   * 删除指定用户的 persona（管理员操作）
   */
  async deleteUserPersona(userId: string): Promise<boolean> {
    await this.ensureInitialized();

    // 清除内存缓存
    this.cachedSummaries.delete(userId);
    this.generatingPromises.delete(userId);

    // 清除 MongoDB
    if (this.db) {
      try {
        const result = await this.db.collection('persona_summaries').deleteOne({ userId });
        console.log(`[PersonaSummary] Deleted persona for user ${userId.substring(0, 12)}...: ${result.deletedCount > 0}`);
        return result.deletedCount > 0;
      } catch (error) {
        console.error('[PersonaSummary] Delete user persona error:', error);
      }
    }
    return false;
  }

  /**
   * 清除所有用户的 persona 缓存（管理员操作）
   * 用于修复记忆混乱后批量重置
   * 仅删除 persona_summaries，不影响 user_memories
   */
  async purgeAllPersonas(): Promise<{ deletedCount: number }> {
    await this.ensureInitialized();

    // 清除内存缓存
    const cachedCount = this.cachedSummaries.size;
    this.cachedSummaries.clear();
    console.log(`[PersonaSummary] Cleared ${cachedCount} in-memory cached personas`);

    // 清除 MongoDB 中所有 persona_summaries
    let deletedCount = 0;
    if (this.db) {
      try {
        const result = await this.db.collection('persona_summaries').deleteMany({});
        deletedCount = result.deletedCount || 0;
        console.log(`[PersonaSummary] Purged ${deletedCount} persona summaries from MongoDB`);
      } catch (error) {
        console.error('[PersonaSummary] Purge error:', error);
      }
    }

    return { deletedCount };
  }
}

// 导出单例
export const personaSummaryService = new PersonaSummaryService();
