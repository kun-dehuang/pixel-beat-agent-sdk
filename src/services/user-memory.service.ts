/**
 * User Memory Service
 *
 * 多用户记忆存储服务
 * 每个用户的记忆独立存储在 MongoDB 中
 */

import { MongoClient, Db } from 'mongodb';

// ==================== 数据类型定义 ====================

export type MemoryType = 'entity' | 'scene' | 'event' | 'habit' | 'emotion';

export interface MemoryUnit {
  id: string;
  userId: string;          // 用户 ID（Apple ID）
  type: MemoryType;
  date: string;
  content: string;
  tags: string[];
  entities: string[];
  location?: string;
  people?: string[];
  emotion?: string;
  activity?: string;
  season?: string;
  source_batch?: string;
  source_image_count?: number;
  created_at: string;
  updated_at?: string;
}

export interface PhotoAnalysis {
  entities?: string[];
  people?: string[];
  location?: string;
  emotion?: string;
  activities?: string[];
  description?: string;
  setting?: string;
  mood?: string;
}

// 叙事角度
export interface NarrativeAngle {
  angle_id: string;
  angle_name: string;
  angle_type: string;
  memory: MemoryUnit;
  confidence: number;
  description: string;
  matched_items?: string[];
}

// 检索结果
export interface RetrievalResult {
  path_a_entity: NarrativeAngle[];
  path_b_emotion: NarrativeAngle[];
  path_c_location: NarrativeAngle[];
  path_d_person: NarrativeAngle[];
  top_narrative_angles: NarrativeAngle[];
}

// 情绪映射
const EMOTION_OPPOSITES: Record<string, string> = {
  '开心': '难过', '难过': '开心',
  '兴奋': '低落', '低落': '兴奋',
  '放松': '压力', '压力': '放松',
  '平静': '焦虑', '焦虑': '平静'
};

const EMOTION_SIMILAR: Record<string, string[]> = {
  '开心': ['开心', 'happy', '高兴', '愉快', '喜悦'],
  '难过': ['难过', 'sad', '伤心', '沮丧', '失落'],
  '兴奋': ['兴奋', 'excited', '激动', '亢奋'],
  '放松': ['放松', '惬意', '舒适', '悠闲'],
  '平静': ['平静', 'neutral', '平和', '淡定']
};

// ==================== UserMemoryService ====================

class UserMemoryService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private initPromise: Promise<void> | null = null;

  // 内存缓存（按 userId）
  private userMemoriesCache: Map<string, {
    memories: MemoryUnit[];
    loadedAt: number;
    indices: {
      entity: Map<string, Set<string>>;
      location: Map<string, Set<string>>;
      people: Map<string, Set<string>>;
      emotion: Map<string, Set<string>>;
    };
  }> = new Map();

  private CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

  /**
   * 确保初始化
   */
  private async ensureInitialized(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.init();
    return this.initPromise;
  }

  private async init(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('[UserMemory] MONGODB_URI not set');
      return;
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db('pixelbeat');

      // 创建索引
      await this.db.collection('user_memories').createIndex({ userId: 1 });
      await this.db.collection('user_memories').createIndex({ userId: 1, date: -1 });
      await this.db.collection('user_memories').createIndex({ userId: 1, entities: 1 });
      await this.db.collection('user_memories').createIndex({ userId: 1, location: 1 });

      console.log('✅ UserMemoryService connected to MongoDB');
    } catch (error) {
      console.error('❌ UserMemoryService MongoDB error:', error);
    }
  }

  /**
   * 清除用户记忆缓存（VLM 写入新记忆后调用）
   */
  invalidateCache(userId: string): void {
    this.userMemoriesCache.delete(userId);
    console.log(`[UserMemory] Cache invalidated for user: ${userId.substring(0, 12)}...`);
  }

  /**
   * 获取用户记忆（带缓存）
   */
  async getUserMemories(userId: string): Promise<MemoryUnit[]> {
    await this.ensureInitialized();

    // 检查缓存
    const cached = this.userMemoriesCache.get(userId);
    if (cached && Date.now() - cached.loadedAt < this.CACHE_TTL) {
      return cached.memories;
    }

    if (!this.db) return [];

    try {
      const memories = await this.db.collection('user_memories')
        .find({ userId })
        .sort({ date: -1 })
        .toArray() as unknown as MemoryUnit[];

      // 构建索引并缓存
      const indices = this.buildIndices(memories);
      this.userMemoriesCache.set(userId, {
        memories,
        loadedAt: Date.now(),
        indices
      });

      console.log(`[UserMemory] Loaded ${memories.length} memories for user ${userId.substring(0, 12)}...`);
      return memories;
    } catch (error) {
      console.error('[UserMemory] Load error:', error);
      return [];
    }
  }

  /**
   * 构建倒排索引
   */
  private buildIndices(memories: MemoryUnit[]) {
    const entity = new Map<string, Set<string>>();
    const location = new Map<string, Set<string>>();
    const people = new Map<string, Set<string>>();
    const emotion = new Map<string, Set<string>>();

    for (const memory of memories) {
      // Entity
      for (const e of memory.entities || []) {
        const key = e.toLowerCase();
        if (!entity.has(key)) entity.set(key, new Set());
        entity.get(key)!.add(memory.id);
      }

      // Location
      if (memory.location) {
        const key = memory.location.toLowerCase();
        if (!location.has(key)) location.set(key, new Set());
        location.get(key)!.add(memory.id);
      }

      // People
      for (const p of memory.people || []) {
        const key = p.toLowerCase();
        if (!people.has(key)) people.set(key, new Set());
        people.get(key)!.add(memory.id);
      }

      // Emotion
      if (memory.emotion) {
        const key = memory.emotion.toLowerCase();
        if (!emotion.has(key)) emotion.set(key, new Set());
        emotion.get(key)!.add(memory.id);
      }
    }

    return { entity, location, people, emotion };
  }

  /**
   * 添加记忆
   */
  async addMemory(userId: string, memory: Omit<MemoryUnit, 'id' | 'userId' | 'created_at'>): Promise<MemoryUnit | null> {
    await this.ensureInitialized();
    if (!this.db) return null;

    const newMemory: MemoryUnit = {
      ...memory,
      id: `mem_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      userId,
      created_at: new Date().toISOString()
    };

    try {
      await this.db.collection('user_memories').insertOne(newMemory);

      // 清除缓存
      this.userMemoriesCache.delete(userId);

      console.log(`[UserMemory] Added memory for ${userId.substring(0, 12)}...`);
      return newMemory;
    } catch (error) {
      console.error('[UserMemory] Add error:', error);
      return null;
    }
  }

  /**
   * 批量导入记忆
   */
  async importMemories(userId: string, memories: Omit<MemoryUnit, 'userId'>[]): Promise<number> {
    await this.ensureInitialized();
    if (!this.db) return 0;

    const docs = memories.map(m => ({
      ...m,
      userId,
      created_at: m.created_at || new Date().toISOString()
    }));

    try {
      const result = await this.db.collection('user_memories').insertMany(docs);
      this.userMemoriesCache.delete(userId);
      console.log(`[UserMemory] Imported ${result.insertedCount} memories for ${userId.substring(0, 12)}...`);
      return result.insertedCount;
    } catch (error) {
      console.error('[UserMemory] Import error:', error);
      return 0;
    }
  }

  /**
   * 4-Path 检索
   */
  async retrieve4Path(
    userId: string,
    photoAnalysis: PhotoAnalysis,
    topK: number = 3
  ): Promise<RetrievalResult> {
    const memories = await this.getUserMemories(userId);
    const cached = this.userMemoriesCache.get(userId);

    const result: RetrievalResult = {
      path_a_entity: [],
      path_b_emotion: [],
      path_c_location: [],
      path_d_person: [],
      top_narrative_angles: []
    };

    if (memories.length === 0) return result;

    const indices = cached?.indices;
    if (!indices) return result;

    // Path A: 实体联结
    result.path_a_entity = this.retrieveByEntity(memories, indices, photoAnalysis, topK);

    // Path B: 情绪共鸣
    result.path_b_emotion = this.retrieveByEmotion(memories, indices, photoAnalysis, topK);

    // Path C: 地点关联
    result.path_c_location = this.retrieveByLocation(memories, indices, photoAnalysis, topK);

    // Path D: 人物关联
    result.path_d_person = this.retrieveByPerson(memories, indices, photoAnalysis, topK);

    // 合并 Top 角度
    const allAngles = [
      ...result.path_a_entity,
      ...result.path_b_emotion,
      ...result.path_c_location,
      ...result.path_d_person
    ];
    result.top_narrative_angles = allAngles
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, topK);

    return result;
  }

  private retrieveByEntity(
    memories: MemoryUnit[],
    indices: any,
    analysis: PhotoAnalysis,
    topK: number
  ): NarrativeAngle[] {
    const matchedIds = new Set<string>();
    const entities = analysis.entities || [];

    for (const entity of entities) {
      const key = entity.toLowerCase();
      const ids = indices.entity.get(key);
      if (ids) ids.forEach((id: string) => matchedIds.add(id));
    }

    return this.toNarrativeAngles(
      memories.filter(m => matchedIds.has(m.id)),
      'entity_bridge',
      '实体联结',
      topK
    );
  }

  private retrieveByEmotion(
    memories: MemoryUnit[],
    indices: any,
    analysis: PhotoAnalysis,
    topK: number
  ): NarrativeAngle[] {
    if (!analysis.emotion && !analysis.mood) return [];

    const emotion = (analysis.emotion || analysis.mood || '').toLowerCase();
    const matchedIds = new Set<string>();

    // 情绪共鸣
    const similarEmotions = EMOTION_SIMILAR[emotion] || [emotion];
    for (const e of similarEmotions) {
      const ids = indices.emotion.get(e.toLowerCase());
      if (ids) ids.forEach((id: string) => matchedIds.add(id));
    }

    return this.toNarrativeAngles(
      memories.filter(m => matchedIds.has(m.id)),
      'emotion_echo',
      '情绪共鸣',
      topK
    );
  }

  private retrieveByLocation(
    memories: MemoryUnit[],
    indices: any,
    analysis: PhotoAnalysis,
    topK: number
  ): NarrativeAngle[] {
    if (!analysis.location) return [];

    const location = analysis.location.toLowerCase();
    const matchedIds = new Set<string>();

    // 模糊匹配地点
    for (const [key, ids] of indices.location.entries()) {
      if (key.includes(location) || location.includes(key)) {
        (ids as Set<string>).forEach(id => matchedIds.add(id));
      }
    }

    return this.toNarrativeAngles(
      memories.filter(m => matchedIds.has(m.id)),
      'location_memory',
      '地点记忆',
      topK
    );
  }

  private retrieveByPerson(
    memories: MemoryUnit[],
    indices: any,
    analysis: PhotoAnalysis,
    topK: number
  ): NarrativeAngle[] {
    const people = analysis.people || [];
    if (people.length === 0) return [];

    const matchedIds = new Set<string>();
    for (const person of people) {
      const key = person.toLowerCase();
      const ids = indices.people.get(key);
      if (ids) ids.forEach((id: string) => matchedIds.add(id));
    }

    return this.toNarrativeAngles(
      memories.filter(m => matchedIds.has(m.id)),
      'person_story',
      '人物故事',
      topK
    );
  }

  private toNarrativeAngles(
    memories: MemoryUnit[],
    angleType: string,
    angleName: string,
    topK: number
  ): NarrativeAngle[] {
    return memories.slice(0, topK).map((memory, i) => ({
      angle_id: `${angleType}_${i}`,
      angle_name: angleName,
      angle_type: angleType,
      memory,
      confidence: 0.8 - i * 0.1,
      description: memory.content.substring(0, 100)
    }));
  }

  /**
   * 关键词搜索
   */
  async keywordSearch(userId: string, query: string, limit: number = 5): Promise<MemoryUnit[]> {
    const memories = await this.getUserMemories(userId);
    if (memories.length === 0) return [];

    const keywords = query.toLowerCase()
      .replace(/[，。！？、]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1);

    if (keywords.length === 0) return [];

    // 计算匹配分数
    const scored = memories.map(mem => {
      let score = 0;
      const content = mem.content.toLowerCase();
      const tags = (mem.tags || []).join(' ').toLowerCase();
      const entities = (mem.entities || []).join(' ').toLowerCase();

      for (const kw of keywords) {
        if (content.includes(kw)) score += 2;
        if (tags.includes(kw)) score += 1;
        if (entities.includes(kw)) score += 1;
        if (mem.location?.toLowerCase().includes(kw)) score += 1;
      }

      return { memory: mem, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.memory);
  }

  /**
   * 获取用户记忆统计
   */
  async getStats(userId: string): Promise<{
    total: number;
    byType: Record<string, number>;
    topLocations: [string, number][];
    topEntities: string[];
  }> {
    const memories = await this.getUserMemories(userId);

    const byType: Record<string, number> = {};
    const locationCounts = new Map<string, number>();
    const entityCounts = new Map<string, number>();

    for (const mem of memories) {
      byType[mem.type] = (byType[mem.type] || 0) + 1;

      if (mem.location) {
        locationCounts.set(mem.location, (locationCounts.get(mem.location) || 0) + 1);
      }

      for (const e of mem.entities || []) {
        entityCounts.set(e, (entityCounts.get(e) || 0) + 1);
      }
    }

    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const topEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([e]) => e);

    return { total: memories.length, byType, topLocations, topEntities };
  }

  /**
   * 获取所有有记忆数据的用户列表（按记忆数量排序）
   */
  async getDistinctUsers(): Promise<{ userId: string; count: number; lastMemoryDate: string }[]> {
    await this.ensureInitialized();
    if (!this.db) return [];

    try {
      const result = await this.db.collection('user_memories').aggregate([
        {
          $group: {
            _id: '$userId',
            count: { $sum: 1 },
            lastMemoryDate: { $max: '$created_at' }
          }
        },
        { $sort: { count: -1 } },
        {
          $project: {
            userId: '$_id',
            count: 1,
            lastMemoryDate: 1,
            _id: 0
          }
        }
      ]).toArray();

      return result as { userId: string; count: number; lastMemoryDate: string }[];
    } catch (error) {
      console.error('[UserMemory] getDistinctUsers error:', error);
      return [];
    }
  }

  /**
   * 删除用户所有记忆
   */
  async deleteAllMemories(userId: string): Promise<number> {
    await this.ensureInitialized();
    if (!this.db) return 0;

    try {
      const result = await this.db.collection('user_memories').deleteMany({ userId });
      this.userMemoriesCache.delete(userId);
      console.log(`[UserMemory] Deleted ${result.deletedCount} memories for ${userId.substring(0, 12)}...`);
      return result.deletedCount;
    } catch (error) {
      console.error('[UserMemory] Delete error:', error);
      return 0;
    }
  }

  /**
   * 迁移现有记忆到用户名下
   */
  async migrateFromFile(userId: string, filePath: string): Promise<number> {
    const fs = await import('fs');

    if (!fs.existsSync(filePath)) {
      console.warn(`[UserMemory] File not found: ${filePath}`);
      return 0;
    }

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const memories = Array.isArray(data) ? data : [];

      return await this.importMemories(userId, memories);
    } catch (error) {
      console.error('[UserMemory] Migration error:', error);
      return 0;
    }
  }
}

// 导出单例
export const userMemoryService = new UserMemoryService();
