/**
 * Memory Service
 * 基于 Mnemonic Director V1.6 的 4-Path 海马体检索实现
 * 加载用户的914条原子记忆，提供检索接口
 */

import * as fs from 'fs';
import * as path from 'path';

// ==================== 数据类型定义 ====================

export type MemoryType = 'entity' | 'scene' | 'event' | 'habit' | 'emotion';

export interface MemoryUnit {
  id: string;
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
  created_at?: string;
}

export interface PhotoAnalysis {
  entities?: string[];
  people?: string[];
  location?: string;
  emotion?: string;
  activities?: string[];
  protagonist?: {
    description?: string;
  };
}

// 检索路径类型
export type RetrievalPath = 'entity' | 'emotion_echo' | 'emotion_contrast' | 'location' | 'person' | 'all';

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

// ==================== 情绪映射 ====================

const EMOTION_OPPOSITES: Record<string, string> = {
  '开心': '难过',
  '难过': '开心',
  'happy': 'sad',
  'sad': 'happy',
  '兴奋': '低落',
  '低落': '兴奋',
  'excited': 'melancholy',
  'melancholy': 'excited',
  '放松': '压力',
  '压力': '放松',
  '平静': '焦虑',
  '焦虑': '平静'
};

const EMOTION_SIMILAR: Record<string, string[]> = {
  '开心': ['开心', 'happy', '高兴', '愉快', '喜悦'],
  '难过': ['难过', 'sad', '伤心', '沮丧', '失落'],
  '兴奋': ['兴奋', 'excited', '激动', '亢奋'],
  '放松': ['放松', '惬意', '舒适', '悠闲'],
  '平静': ['平静', 'neutral', '平和', '淡定']
};

// ==================== MemoryService 类 ====================

export class MemoryService {
  private static instance: MemoryService;
  private memories: MemoryUnit[] = [];
  private isLoaded: boolean = false;

  // 倒排索引
  private entityIndex: Map<string, Set<string>> = new Map();
  private locationIndex: Map<string, Set<string>> = new Map();
  private peopleIndex: Map<string, Set<string>> = new Map();
  private emotionIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  private constructor() {}

  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }

  /**
   * 加载记忆数据
   */
  async loadMemories(memoryFilePath?: string): Promise<void> {
    if (this.isLoaded) {
      return;
    }

    // 默认路径：项目根目录下的 data/memories.json
    const defaultPath = path.join(__dirname, '../../data/memories.json');
    const filePath = memoryFilePath || process.env.MEMORY_DB_PATH || defaultPath;

    try {
      if (!fs.existsSync(filePath)) {
        console.warn(`[MemoryService] Memory file not found: ${filePath}`);
        this.memories = [];
        this.isLoaded = true;
        return;
      }

      const rawData = fs.readFileSync(filePath, 'utf-8');
      this.memories = JSON.parse(rawData) as MemoryUnit[];

      // 构建倒排索引
      this.buildIndices();

      console.log(`[MemoryService] Loaded ${this.memories.length} memories`);
      this.isLoaded = true;
    } catch (error) {
      console.error('[MemoryService] Failed to load memories:', error);
      this.memories = [];
      this.isLoaded = true;
    }
  }

  /**
   * 构建倒排索引
   */
  private buildIndices(): void {
    for (const memory of this.memories) {
      // Entity 索引
      for (const entity of memory.entities || []) {
        const normalized = entity.toLowerCase();
        if (!this.entityIndex.has(normalized)) {
          this.entityIndex.set(normalized, new Set());
        }
        this.entityIndex.get(normalized)!.add(memory.id);
      }

      // Location 索引
      if (memory.location) {
        const normalized = memory.location.toLowerCase();
        if (!this.locationIndex.has(normalized)) {
          this.locationIndex.set(normalized, new Set());
        }
        this.locationIndex.get(normalized)!.add(memory.id);
      }

      // People 索引
      for (const person of memory.people || []) {
        const normalized = person.toLowerCase();
        if (!this.peopleIndex.has(normalized)) {
          this.peopleIndex.set(normalized, new Set());
        }
        this.peopleIndex.get(normalized)!.add(memory.id);
      }

      // Emotion 索引
      if (memory.emotion) {
        const normalized = memory.emotion.toLowerCase();
        if (!this.emotionIndex.has(normalized)) {
          this.emotionIndex.set(normalized, new Set());
        }
        this.emotionIndex.get(normalized)!.add(memory.id);
      }

      // Tag 索引
      for (const tag of memory.tags || []) {
        const normalized = tag.toLowerCase();
        if (!this.tagIndex.has(normalized)) {
          this.tagIndex.set(normalized, new Set());
        }
        this.tagIndex.get(normalized)!.add(memory.id);
      }
    }

    console.log(`[MemoryService] Built indices: ${this.entityIndex.size} entities, ${this.locationIndex.size} locations, ${this.peopleIndex.size} people`);
  }

  /**
   * 4-Path 海马体检索
   * 注意：此方法使用全局记忆文件，用于向后兼容
   * 新的多用户场景请使用 UserMemoryService
   */
  async retrieve4Path(
    photoAnalysis: PhotoAnalysis,
    paths: RetrievalPath[] = ['all'],
    topK: number = 3,
    minConfidence: number = 0.5,
    userId?: string
  ): Promise<RetrievalResult> {
    await this.loadMemories();

    const result: RetrievalResult = {
      path_a_entity: [],
      path_b_emotion: [],
      path_c_location: [],
      path_d_person: [],
      top_narrative_angles: []
    };

    const enableAll = paths.includes('all');

    // Path A: 实体联结 (Entity Bridging)
    if (enableAll || paths.includes('entity')) {
      result.path_a_entity = this.retrieveByEntity(photoAnalysis, topK, minConfidence);
    }

    // Path B: 情绪反差/共鸣 (Emotional Echo/Contrast)
    if (enableAll || paths.includes('emotion_echo') || paths.includes('emotion_contrast')) {
      result.path_b_emotion = this.retrieveByEmotion(
        photoAnalysis,
        topK,
        minConfidence,
        paths.includes('emotion_contrast')
      );
    }

    // Path C: 时空锚点 (Contextual Anchoring)
    if (enableAll || paths.includes('location')) {
      result.path_c_location = this.retrieveByLocation(photoAnalysis, topK, minConfidence);
    }

    // Path D: 人物羁绊 (Social Bonds)
    if (enableAll || paths.includes('person')) {
      result.path_d_person = this.retrieveByPerson(photoAnalysis, topK, minConfidence);
    }

    // 合并所有角度，按置信度排序，取 Top 5
    const allAngles = [
      ...result.path_a_entity,
      ...result.path_b_emotion,
      ...result.path_c_location,
      ...result.path_d_person
    ];

    allAngles.sort((a, b) => b.confidence - a.confidence);
    result.top_narrative_angles = allAngles.slice(0, 5);

    return result;
  }

  /**
   * Path A: 实体联结
   */
  private retrieveByEntity(
    photoAnalysis: PhotoAnalysis,
    topK: number,
    minConfidence: number
  ): NarrativeAngle[] {
    const currentEntities = new Set(
      (photoAnalysis.entities || []).map(e => e.toLowerCase())
    );

    if (currentEntities.size === 0) return [];

    const matchedMemories: Map<string, { memory: MemoryUnit; matchedEntities: string[] }> = new Map();

    for (const entity of currentEntities) {
      const memoryIds = this.entityIndex.get(entity);
      if (memoryIds) {
        for (const memId of memoryIds) {
          const memory = this.memories.find(m => m.id === memId);
          if (memory) {
            if (!matchedMemories.has(memId)) {
              matchedMemories.set(memId, { memory, matchedEntities: [] });
            }
            matchedMemories.get(memId)!.matchedEntities.push(entity);
          }
        }
      }
    }

    const angles: NarrativeAngle[] = [];
    for (const [memId, { memory, matchedEntities }] of matchedMemories) {
      const confidence = matchedEntities.length / currentEntities.size;
      if (confidence >= minConfidence) {
        angles.push({
          angle_id: `entity_${memId}`,
          angle_name: `物品延续: ${matchedEntities.slice(0, 2).join(', ')}`,
          angle_type: 'entity_continuation',
          memory,
          confidence,
          description: `通过物品"${matchedEntities.join(', ')}"连接到记忆`,
          matched_items: matchedEntities
        });
      }
    }

    angles.sort((a, b) => b.confidence - a.confidence);
    return angles.slice(0, topK);
  }

  /**
   * Path B: 情绪反差/共鸣
   */
  private retrieveByEmotion(
    photoAnalysis: PhotoAnalysis,
    topK: number,
    minConfidence: number,
    preferContrast: boolean = true
  ): NarrativeAngle[] {
    const currentEmotion = photoAnalysis.emotion?.toLowerCase();
    if (!currentEmotion) return [];

    const angles: NarrativeAngle[] = [];

    // 优先查找情绪反差（高优先级 0.95）
    if (preferContrast) {
      const oppositeEmotion = EMOTION_OPPOSITES[currentEmotion];
      if (oppositeEmotion) {
        for (const memory of this.memories) {
          const memEmotion = memory.emotion?.toLowerCase();
          if (memEmotion && this.isEmotionMatch(memEmotion, oppositeEmotion)) {
            angles.push({
              angle_id: `emotion_contrast_${memory.id}`,
              angle_name: `情绪反差: ${memEmotion} → ${currentEmotion}`,
              angle_type: 'emotional_contrast',
              memory,
              confidence: 0.95, // 情绪反差优先级最高
              description: `强烈情绪反差叙事：从"${memEmotion}"到"${currentEmotion}"`,
              matched_items: [memEmotion, currentEmotion]
            });
          }
        }
      }
    }

    // 然后查找情绪共鸣
    const similarEmotions = EMOTION_SIMILAR[currentEmotion] || [currentEmotion];
    for (const memory of this.memories) {
      const memEmotion = memory.emotion?.toLowerCase();
      if (memEmotion && similarEmotions.some(e => this.isEmotionMatch(memEmotion, e))) {
        // 避免重复
        if (!angles.some(a => a.memory.id === memory.id)) {
          angles.push({
            angle_id: `emotion_echo_${memory.id}`,
            angle_name: `情绪共鸣: ${memEmotion}`,
            angle_type: 'emotional_echo',
            memory,
            confidence: 0.75,
            description: `相同情绪叙事：都是"${memEmotion}"`,
            matched_items: [memEmotion]
          });
        }
      }
    }

    angles.sort((a, b) => b.confidence - a.confidence);
    return angles.slice(0, topK);
  }

  /**
   * Path C: 时空锚点
   */
  private retrieveByLocation(
    photoAnalysis: PhotoAnalysis,
    topK: number,
    minConfidence: number
  ): NarrativeAngle[] {
    const currentLocation = photoAnalysis.location?.toLowerCase();
    if (!currentLocation) return [];

    const angles: NarrativeAngle[] = [];

    for (const memory of this.memories) {
      const memLocation = memory.location?.toLowerCase();
      if (memLocation && this.isLocationMatch(memLocation, currentLocation)) {
        angles.push({
          angle_id: `location_${memory.id}`,
          angle_name: `地点延续: ${memory.location}`,
          angle_type: 'contextual_anchor',
          memory,
          confidence: 0.80,
          description: `同一地点的时间对比`,
          matched_items: [memory.location || '']
        });
      }
    }

    angles.sort((a, b) => b.confidence - a.confidence);
    return angles.slice(0, topK);
  }

  /**
   * Path D: 人物羁绊
   */
  private retrieveByPerson(
    photoAnalysis: PhotoAnalysis,
    topK: number,
    minConfidence: number
  ): NarrativeAngle[] {
    const currentPeople = new Set(
      (photoAnalysis.people || []).map(p => p.toLowerCase())
    );

    if (currentPeople.size === 0) return [];

    const matchedMemories: Map<string, { memory: MemoryUnit; matchedPeople: string[] }> = new Map();

    for (const person of currentPeople) {
      // 跳过"主角"的泛化匹配
      if (person === '主角' || person === 'protagonist') continue;

      const memoryIds = this.peopleIndex.get(person);
      if (memoryIds) {
        for (const memId of memoryIds) {
          const memory = this.memories.find(m => m.id === memId);
          if (memory) {
            if (!matchedMemories.has(memId)) {
              matchedMemories.set(memId, { memory, matchedPeople: [] });
            }
            matchedMemories.get(memId)!.matchedPeople.push(person);
          }
        }
      }
    }

    const angles: NarrativeAngle[] = [];
    for (const [memId, { memory, matchedPeople }] of matchedMemories) {
      angles.push({
        angle_id: `person_${memId}`,
        angle_name: `人物羁绊: ${matchedPeople.slice(0, 2).join(', ')}`,
        angle_type: 'social_bond',
        memory,
        confidence: 1.0, // 人物匹配置信度最高
        description: `通过人物"${matchedPeople.join(', ')}"连接`,
        matched_items: matchedPeople
      });
    }

    angles.sort((a, b) => b.confidence - a.confidence);
    return angles.slice(0, topK);
  }

  /**
   * 模糊匹配情绪
   */
  private isEmotionMatch(emotion1: string, emotion2: string): boolean {
    if (emotion1 === emotion2) return true;
    // 检查是否在同一个情绪组
    for (const group of Object.values(EMOTION_SIMILAR)) {
      if (group.includes(emotion1) && group.includes(emotion2)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 模糊匹配地点
   */
  private isLocationMatch(location1: string, location2: string): boolean {
    if (location1 === location2) return true;
    // 简单的包含匹配
    if (location1.includes(location2) || location2.includes(location1)) {
      return true;
    }
    // 关键词重叠
    const words1 = new Set(location1.split(/[\s,，、]/));
    const words2 = new Set(location2.split(/[\s,，、]/));
    const overlap = [...words1].filter(w => words2.has(w)).length;
    return overlap >= 1 && overlap / Math.min(words1.size, words2.size) > 0.3;
  }

  /**
   * 按关键词搜索（兼容旧接口）
   */
  async searchByKeywords(keywords: string[], topK: number = 5): Promise<MemoryUnit[]> {
    await this.loadMemories();

    const normalizedKeywords = keywords.map(k => k.toLowerCase());
    const scores: Map<string, number> = new Map();

    for (const memory of this.memories) {
      let score = 0;

      // 检查 tags
      for (const tag of memory.tags || []) {
        if (normalizedKeywords.some(k => tag.toLowerCase().includes(k))) {
          score += 2;
        }
      }

      // 检查 entities
      for (const entity of memory.entities || []) {
        if (normalizedKeywords.some(k => entity.toLowerCase().includes(k))) {
          score += 2;
        }
      }

      // 检查 content
      for (const keyword of normalizedKeywords) {
        if (memory.content.toLowerCase().includes(keyword)) {
          score += 1;
        }
      }

      // 检查 location
      if (memory.location) {
        for (const keyword of normalizedKeywords) {
          if (memory.location.toLowerCase().includes(keyword)) {
            score += 1;
          }
        }
      }

      if (score > 0) {
        scores.set(memory.id, score);
      }
    }

    // 排序并返回 Top-K
    const sortedIds = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id]) => id);

    return this.memories.filter(m => sortedIds.includes(m.id));
  }

  /**
   * 获取记忆统计
   */
  getStats(): {
    total: number;
    byType: Record<string, number>;
    topTags: [string, number][];
    topLocations: [string, number][];
    entities: number;
    locations: number;
    people: number;
    topEntities: string[];
  } {
    const byType: Record<string, number> = {};
    const tagCounts: Map<string, number> = new Map();
    const locationCounts: Map<string, number> = new Map();

    for (const memory of this.memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;

      for (const tag of memory.tags || []) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }

      if (memory.location) {
        locationCounts.set(memory.location, (locationCounts.get(memory.location) || 0) + 1);
      }
    }

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    const topLocations = [...locationCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // 统计实体、地点、人物
    const entities = this.entityIndex.size;
    const locations = this.locationIndex.size;
    const people = this.peopleIndex.size;

    // Top entities
    const entityCounts = new Map<string, number>();
    for (const [entity, ids] of this.entityIndex) {
      entityCounts.set(entity, ids.size);
    }
    const topEntities = [...entityCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([e]) => e);

    return {
      total: this.memories.length,
      byType,
      topTags,
      topLocations,
      entities,
      locations,
      people,
      topEntities
    };
  }

  /**
   * 获取所有记忆
   */
  getAllMemories(): MemoryUnit[] {
    return this.memories;
  }
}
