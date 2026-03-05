/**
 * VLM Analysis Service
 *
 * Phase 1: 使用 Gemini 2.0 Flash 批量分析照片
 * - 每批 10 张照片
 * - 提取场景、活动、情绪、人物等信息
 * - 存储到 MongoDB 作为用户记忆
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { MongoClient, Db } from 'mongodb';
import { userMemoryService } from './user-memory.service';

// ==================== 类型定义 ====================

export interface PhotoInput {
  id: string;              // 照片本地 ID
  base64: string;          // Base64 编码的图片数据
  mimeType: string;        // 如 "image/jpeg"
  timestamp?: string;      // 拍摄时间 ISO 格式
  location?: {             // GPS 位置信息
    latitude: number;
    longitude: number;
    altitude?: number;
    accuracy?: number;
  };
  metadata?: {
    width?: number;
    height?: number;
    location?: string;
  };
}

export interface GeocodedLocation {
  latitude: number;
  longitude: number;
  address?: string;        // 详细地址
  poi?: string;            // 兴趣点名称（如店铺、景点）
  district?: string;       // 区/县
  city?: string;           // 城市
  province?: string;       // 省份
  country?: string;        // 国家
}

export interface PersonInPhoto {
  role: string;            // "主人" | "朋友" | "家人" | "同事" | "伴侣" | "陌生人" 等
  appearance: string;      // 简要外貌特征，用于跨照片追踪同一人
  interaction: string;     // 与主人的互动描述（如"一起用餐"、"合影"、"对话"）
  closeness: string;       // 亲密度推测: "亲密" | "熟悉" | "一般" | "疏远"
}

export interface PhotoAnalysisResult {
  photoId: string;
  scene: string;           // 场景类型
  activity: string;        // 活动类型
  emotion: string;         // 情绪
  people: string;          // 人物描述（兼容旧格式）
  peopleDetails: PersonInPhoto[]; // 详细人物信息
  isOwnerPresent: boolean; // 手机主人是否出现在照片中
  ownerActivity: string;   // 主人正在做什么
  locationHint: string;    // 地点线索
  locationType: string;    // 地点类型
  timeOfDay: string;       // 时间特征
  lifestyleClues: string[];// 生活方式线索
  gpsLocation?: GeocodedLocation; // GPS 位置（如有）
}

export interface BatchAnalysisResult {
  batchId: string;         // 批次 ID，如 "2024-01"
  photos: PhotoAnalysisResult[];
  batchSummary: string;    // 批次总结
  notablePatterns: string[];// 显著模式
  relationshipObservations: string[]; // 人际关系观察
  analyzedAt: number;
  tokenUsage: number;
  latencyMs: number;
}

export interface AnalysisProgress {
  userId: string;
  status: 'pending' | 'analyzing' | 'completed' | 'error';
  totalPhotos: number;
  analyzedPhotos: number;
  totalBatches: number;
  completedBatches: number;
  currentBatchId?: string;
  results: BatchAnalysisResult[];
  startedAt: number;
  updatedAt: number;
  error?: string;
}

// ==================== VLM 分析服务 ====================

class VLMAnalysisService {
  private genAI: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private initialized: boolean = false;

  // 配置
  private readonly BATCH_SIZE = 10;
  private readonly MODEL_NAME = 'gemini-2.0-flash';  // Gemini 2.0 Flash (stable)
  private readonly MAX_CONCURRENT = 3;
  private readonly MAX_PHOTOS = 500;           // 最多分析 500 张
  private readonly MAX_AGE_DAYS = 365;         // 仅分析最近 1 年内的照片

  constructor() {
    // 懒初始化
  }

  /**
   * 初始化服务
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // 初始化 Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for VLM analysis');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: this.MODEL_NAME,
      generationConfig: {
        temperature: 0.3,  // 低温度保证一致性
        maxOutputTokens: 4096
      }
    });

    console.log(`✅ VLM Service initialized with ${this.MODEL_NAME}`);

    // 初始化 MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (mongoUri) {
      try {
        this.client = new MongoClient(mongoUri);
        await this.client.connect();
        this.db = this.client.db('pixelbeat');
        console.log('✅ VLM Service connected to MongoDB');
      } catch (error) {
        console.error('❌ VLM Service MongoDB connection failed:', error);
      }
    }

    this.initialized = true;
  }

  /**
   * 逆地理编码 - 将 GPS 坐标转换为详细地址
   */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodedLocation | null> {
    try {
      // 使用 Nominatim (OpenStreetMap) 免费 API
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=zh-CN`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'PixelBeat/1.0 (photo-memory-app)'
        }
      });

      if (!response.ok) {
        console.warn(`[Geocode] Failed: ${response.status}`);
        return null;
      }

      const data = await response.json() as {
        display_name?: string;
        error?: string;
        address?: {
          amenity?: string;
          shop?: string;
          tourism?: string;
          building?: string;
          suburb?: string;
          district?: string;
          county?: string;
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          province?: string;
          country?: string;
        };
      };

      if (!data || data.error) {
        return null;
      }

      const address = data.address || {};

      return {
        latitude: lat,
        longitude: lng,
        address: data.display_name,
        poi: address.amenity || address.shop || address.tourism || address.building,
        district: address.suburb || address.district || address.county,
        city: address.city || address.town || address.village,
        province: address.state || address.province,
        country: address.country
      };
    } catch (error) {
      console.error('[Geocode] Error:', error);
      return null;
    }
  }

  /**
   * 批量逆地理编码（带缓存和限速）
   */
  private locationCache = new Map<string, GeocodedLocation>();

  async batchReverseGeocode(photos: PhotoInput[]): Promise<Map<string, GeocodedLocation>> {
    const results = new Map<string, GeocodedLocation>();

    for (const photo of photos) {
      if (!photo.location) continue;

      const { latitude, longitude } = photo.location;
      const cacheKey = `${latitude.toFixed(4)},${longitude.toFixed(4)}`;

      // 检查缓存
      if (this.locationCache.has(cacheKey)) {
        results.set(photo.id, this.locationCache.get(cacheKey)!);
        continue;
      }

      // 调用逆地理编码（限速：每秒 1 次）
      const location = await this.reverseGeocode(latitude, longitude);
      if (location) {
        this.locationCache.set(cacheKey, location);
        results.set(photo.id, location);
      }

      // 限速等待
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return results;
  }

  /**
   * 分析单批照片 (核心方法)
   */
  async analyzeBatch(
    userId: string,
    photos: PhotoInput[],
    batchId: string
  ): Promise<BatchAnalysisResult> {
    await this.initialize();

    if (!this.model) {
      throw new Error('VLM model not initialized');
    }

    const startTime = Date.now();
    console.log(`[VLM] Analyzing batch ${batchId}: ${photos.length} photos`);

    // 逆地理编码（获取精确地址）
    const photosWithLocation = photos.filter(p => p.location);
    let geocodedLocations: Map<string, GeocodedLocation> | undefined;

    if (photosWithLocation.length > 0) {
      console.log(`[VLM] Reverse geocoding ${photosWithLocation.length} photos with GPS...`);
      geocodedLocations = await this.batchReverseGeocode(photosWithLocation);
      console.log(`[VLM] Geocoded ${geocodedLocations.size} locations`);
    }

    // 构建图片 parts
    const imageParts = photos.map((photo, index) => ({
      inlineData: {
        data: photo.base64,
        mimeType: photo.mimeType || 'image/jpeg'
      }
    }));

    // 构建提示词（包含地理位置信息）
    const prompt = this.buildAnalysisPrompt(photos, geocodedLocations);

    try {
      // 调用 Gemini VLM
      const result = await this.model.generateContent([
        { text: prompt },
        ...imageParts
      ]);

      const response = result.response;
      const text = response.text();
      const tokenUsage = response.usageMetadata?.totalTokenCount || 0;

      // 解析结果
      const parsed = this.parseVLMResponse(text, photos);

      const batchResult: BatchAnalysisResult = {
        batchId,
        photos: parsed.photos,
        batchSummary: parsed.batchSummary,
        notablePatterns: parsed.notablePatterns,
        relationshipObservations: parsed.relationshipObservations || [],
        analyzedAt: Date.now(),
        tokenUsage,
        latencyMs: Date.now() - startTime
      };

      console.log(`[VLM] Batch ${batchId} completed in ${batchResult.latencyMs}ms`);

      // 存储到 MongoDB（传入原始 photos 以获取拍摄时间戳）
      await this.storeBatchResult(userId, batchResult, photos);

      return batchResult;

    } catch (error) {
      console.error(`[VLM] Batch ${batchId} failed:`, error);
      throw error;
    }
  }

  /**
   * 过滤照片（仅保留最近 1 年内的，最多 500 张）
   */
  filterPhotos(photos: PhotoInput[]): PhotoInput[] {
    const oneYearAgo = Date.now() - this.MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    // 1. 过滤时间范围
    let filtered = photos.filter(photo => {
      if (!photo.timestamp) return true; // 无时间戳的保留
      try {
        const photoTime = new Date(photo.timestamp).getTime();
        return photoTime >= oneYearAgo;
      } catch {
        return true;
      }
    });

    // 2. 按时间排序（最新的优先）
    filtered.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });

    // 3. 限制数量
    if (filtered.length > this.MAX_PHOTOS) {
      console.log(`[VLM] Limiting photos from ${filtered.length} to ${this.MAX_PHOTOS}`);
      filtered = filtered.slice(0, this.MAX_PHOTOS);
    }

    console.log(`[VLM] Filtered: ${photos.length} -> ${filtered.length} photos (last ${this.MAX_AGE_DAYS} days, max ${this.MAX_PHOTOS})`);
    return filtered;
  }

  /**
   * 分析所有照片 (带进度追踪)
   */
  async analyzeAllPhotos(
    userId: string,
    photos: PhotoInput[],
    onProgress?: (progress: AnalysisProgress) => void
  ): Promise<AnalysisProgress> {
    await this.initialize();

    // 过滤照片
    const filteredPhotos = this.filterPhotos(photos);

    // 按月份分组
    const batches = this.groupPhotosByMonth(filteredPhotos);
    const batchIds = Object.keys(batches).sort().reverse(); // 最近的先分析

    // 初始化进度
    const progress: AnalysisProgress = {
      userId,
      status: 'analyzing',
      totalPhotos: filteredPhotos.length,
      analyzedPhotos: 0,
      totalBatches: batchIds.length,
      completedBatches: 0,
      results: [],
      startedAt: Date.now(),
      updatedAt: Date.now()
    };

    // 存储初始进度
    await this.saveProgress(progress);
    onProgress?.(progress);

    try {
      // 逐批分析
      for (const batchId of batchIds) {
        const batchPhotos = batches[batchId];
        progress.currentBatchId = batchId;
        progress.updatedAt = Date.now();

        // 分批处理（每批最多 BATCH_SIZE 张）
        for (let i = 0; i < batchPhotos.length; i += this.BATCH_SIZE) {
          const chunk = batchPhotos.slice(i, i + this.BATCH_SIZE);
          const subBatchId = `${batchId}-${Math.floor(i / this.BATCH_SIZE)}`;

          try {
            const result = await this.analyzeBatch(userId, chunk, subBatchId);
            progress.results.push(result);
            progress.analyzedPhotos += chunk.length;
            progress.updatedAt = Date.now();

            await this.saveProgress(progress);
            onProgress?.(progress);

          } catch (error) {
            console.error(`[VLM] Sub-batch ${subBatchId} failed:`, error);
            // 继续下一批，不中断整体流程
          }
        }

        progress.completedBatches++;
      }

      // 完成：检查是否有实际分析结果
      if (progress.results.length === 0) {
        progress.status = 'error';
        progress.error = '所有照片分析均失败，请稍后重试';
      } else {
        progress.status = 'completed';
      }
      progress.currentBatchId = undefined;
      progress.updatedAt = Date.now();

      await this.saveProgress(progress);
      onProgress?.(progress);

      // 清除用户记忆缓存，确保后续生成 persona 能读到新写入的记忆
      userMemoryService.invalidateCache(userId);

      console.log(`[VLM] Analysis completed: ${progress.analyzedPhotos}/${progress.totalPhotos} photos`);

      return progress;

    } catch (error) {
      progress.status = 'error';
      progress.error = error instanceof Error ? error.message : 'Unknown error';
      progress.updatedAt = Date.now();

      await this.saveProgress(progress);
      onProgress?.(progress);

      throw error;
    }
  }

  /**
   * 获取分析进度
   */
  async getProgress(userId: string): Promise<AnalysisProgress | null> {
    if (!this.db) return null;

    try {
      const doc = await this.db.collection('vlm_analysis_progress').findOne({ userId });
      return doc as unknown as AnalysisProgress;
    } catch (error) {
      console.error('[VLM] Get progress failed:', error);
      return null;
    }
  }

  /**
   * 获取用户的所有分析结果
   */
  async getUserAnalysisResults(userId: string): Promise<BatchAnalysisResult[]> {
    if (!this.db) return [];

    try {
      const docs = await this.db
        .collection('vlm_batch_results')
        .find({ userId })
        .sort({ analyzedAt: -1 })
        .toArray();

      return docs.map(doc => ({
        batchId: doc.batchId,
        photos: doc.photos,
        batchSummary: doc.batchSummary,
        notablePatterns: doc.notablePatterns,
        relationshipObservations: doc.relationshipObservations || [],
        analyzedAt: doc.analyzedAt,
        tokenUsage: doc.tokenUsage,
        latencyMs: doc.latencyMs
      }));
    } catch (error) {
      console.error('[VLM] Get results failed:', error);
      return [];
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 构建分析提示词
   */
  private buildAnalysisPrompt(photos: PhotoInput[], geocodedLocations?: Map<string, GeocodedLocation>): string {
    const photoList = photos.map((p, i) => {
      let info = `照片 ${i + 1}`;
      if (p.timestamp) info += ` (${p.timestamp})`;

      // 添加 GPS 位置信息
      if (p.location) {
        const geo = geocodedLocations?.get(p.id);
        if (geo) {
          // 有逆地理编码结果，使用详细地址
          const parts = [geo.poi, geo.district, geo.city].filter(Boolean);
          if (parts.length > 0) {
            info += ` [GPS: ${parts.join(', ')}]`;
          }
        } else {
          // 仅有坐标
          info += ` [GPS: ${p.location.latitude.toFixed(4)}, ${p.location.longitude.toFixed(4)}]`;
        }
      }

      return info;
    }).join('\n');

    return `分析以下 ${photos.length} 张照片，提取每张照片的关键信息。

## 照片列表（部分包含 GPS 位置信息）
${photoList}

## 请提取以下信息

对于每张照片：
1. **scene**: 场景类型（如：办公室、餐厅、户外、家中、咖啡店、健身房等）
2. **activity**: 正在进行的活动（如：工作、用餐、旅行、社交、运动、休闲等）
3. **emotion**: 照片传达的情绪（如：专注、放松、愉快、平静、兴奋、温馨等）
4. **people**: 人物总览描述（如：独自、与朋友、与家人、与同事、无人等）
5. **is_owner_present**: 手机主人是否出现在照片中（true/false）
6. **owner_activity**: 如果主人出现，主人在做什么
7. **people_details**: 照片中每个可识别的人物的详细信息（数组），每个人包含：
   - **role**: 推测与主人的关系（"主人"、"朋友"、"家人"、"伴侣"、"同事"、"陌生人"等）
   - **appearance**: 简要外貌特征，用于跨照片追踪同一人（如"短发男性，戴眼镜"、"长发女性，穿红裙"）
   - **interaction**: 与主人的互动（如"一起用餐"、"合影"、"对话"、"拥抱"）
   - **closeness**: 亲密度推测（"亲密"、"熟悉"、"一般"、"疏远"）
8. **location_hint**: 地点识别（尽可能具体）
9. **location_type**: 地点类型
10. **time_of_day**: 时间特征
11. **lifestyle_clues**: 生活方式线索（数组）

## 人物分析重点

这是最重要的分析维度：
- **判断谁是手机主人**：通常是自拍中的主角、被拍最多的人、或照片视角的持有者（如果照片是第一视角则主人不出现）
- **识别重复出现的人物**：通过外貌特征（发型、体型、穿着风格）跨照片追踪同一人
- **推测人物关系**：根据互动方式、身体距离、场合、表情判断关系
- **记录互动细节**：他们一起在做什么，这是理解关系深度的关键

## 地点分析（简要）
- 结合 GPS 坐标与图像内容推断地点
- 识别到店名或地标即可，不需过度详细

## 输出格式

请输出 JSON 格式：
\`\`\`json
{
  "photos": [
    {
      "index": 0,
      "scene": "餐厅",
      "activity": "聚餐",
      "emotion": "愉快",
      "people": "与朋友",
      "is_owner_present": true,
      "owner_activity": "和朋友一起吃火锅",
      "people_details": [
        {"role": "主人", "appearance": "短发男性，戴黑框眼镜", "interaction": "拍照", "closeness": "—"},
        {"role": "朋友", "appearance": "长发女性，穿白色卫衣", "interaction": "一起用餐，有说有笑", "closeness": "亲密"},
        {"role": "朋友", "appearance": "寸头男性，戴棒球帽", "interaction": "一起用餐", "closeness": "熟悉"}
      ],
      "location_hint": "海底捞",
      "location_type": "餐厅",
      "time_of_day": "晚上",
      "lifestyle_clues": ["喜欢社交", "爱吃火锅"]
    }
  ],
  "batch_summary": "这批照片主要记录了用户的社交生活...",
  "notable_patterns": ["经常和朋友聚餐"],
  "relationship_observations": ["有一位长发女性朋友出现频率高，关系亲密", "经常和2-3人小团体活动"]
}
\`\`\`

请确保：
- photos 数组长度与输入照片数量一致
- index 从 0 开始，与照片顺序对应
- people_details 尽量详细，即使只有一个人也要填写
- 如果照片中没有人，people_details 为空数组
- relationship_observations 总结这批照片中观察到的人际关系特点
- 所有字段都有合理的值，不要留空`;
  }

  /**
   * 解析 VLM 响应
   */
  private parseVLMResponse(
    text: string,
    photos: PhotoInput[]
  ): { photos: PhotoAnalysisResult[]; batchSummary: string; notablePatterns: string[]; relationshipObservations: string[] } {
    try {
      // 提取 JSON
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                        text.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        console.error('[VLM] No JSON found in response');
        return this.createEmptyResult(photos);
      }

      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      // 映射结果
      const photoResults: PhotoAnalysisResult[] = photos.map((photo, index) => {
        const result = parsed.photos?.find((p: any) => p.index === index) || parsed.photos?.[index] || {};

        return {
          photoId: photo.id,
          scene: result.scene || '未知',
          activity: result.activity || '未知',
          emotion: result.emotion || '未知',
          people: result.people || '未知',
          peopleDetails: (result.people_details || []).map((p: any) => ({
            role: p.role || '未知',
            appearance: p.appearance || '',
            interaction: p.interaction || '',
            closeness: p.closeness || '一般'
          })),
          isOwnerPresent: result.is_owner_present ?? false,
          ownerActivity: result.owner_activity || '',
          locationHint: result.location_hint || '',
          locationType: result.location_type || '',
          timeOfDay: result.time_of_day || '未知',
          lifestyleClues: result.lifestyle_clues || []
        };
      });

      return {
        photos: photoResults,
        batchSummary: parsed.batch_summary || '',
        notablePatterns: parsed.notable_patterns || [],
        relationshipObservations: parsed.relationship_observations || []
      };

    } catch (error) {
      console.error('[VLM] Parse response failed:', error);
      return this.createEmptyResult(photos);
    }
  }

  /**
   * 创建空结果（解析失败时）
   */
  private createEmptyResult(photos: PhotoInput[]) {
    return {
      photos: photos.map(p => ({
        photoId: p.id,
        scene: '未知',
        activity: '未知',
        emotion: '未知',
        people: '未知',
        peopleDetails: [],
        isOwnerPresent: false,
        ownerActivity: '',
        locationHint: '',
        locationType: '',
        timeOfDay: '未知',
        lifestyleClues: []
      })),
      batchSummary: '分析结果解析失败',
      notablePatterns: [],
      relationshipObservations: []
    };
  }

  /**
   * 按月份分组照片
   */
  private groupPhotosByMonth(photos: PhotoInput[]): Record<string, PhotoInput[]> {
    const groups: Record<string, PhotoInput[]> = {};

    for (const photo of photos) {
      let monthKey = 'unknown';

      if (photo.timestamp) {
        try {
          const date = new Date(photo.timestamp);
          monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        } catch {
          // 保持 unknown
        }
      }

      if (!groups[monthKey]) {
        groups[monthKey] = [];
      }
      groups[monthKey].push(photo);
    }

    return groups;
  }

  /**
   * 存储批次结果
   */
  private async storeBatchResult(userId: string, result: BatchAnalysisResult, originalPhotos?: PhotoInput[]): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.collection('vlm_batch_results').insertOne({
        userId,
        ...result
      });

      // 构建 photoId → 原始拍摄时间 的映射
      const timestampMap = new Map<string, string>();
      if (originalPhotos) {
        for (const p of originalPhotos) {
          if (p.timestamp) {
            timestampMap.set(p.id, p.timestamp);
          }
        }
      }

      // 同时存储为用户记忆（供 Phase 2 使用）
      const memories = result.photos.map(photo => ({
        userId,
        type: 'vlm_analysis',
        photoId: photo.photoId,
        content: `${photo.scene} - ${photo.activity}`,
        scene: photo.scene,
        activity: photo.activity,
        emotion: photo.emotion,
        people: photo.people,
        peopleDetails: photo.peopleDetails || [],
        isOwnerPresent: photo.isOwnerPresent ?? false,
        ownerActivity: photo.ownerActivity || '',
        location: photo.locationHint,
        tags: photo.lifestyleClues,
        date: timestampMap.get(photo.photoId) || new Date().toISOString(),
        batchId: result.batchId,
        createdAt: Date.now()
      }));

      // 存储批次级别的人际关系观察
      if (result.relationshipObservations && result.relationshipObservations.length > 0) {
        await this.db!.collection('user_memories').insertOne({
          userId,
          type: 'relationship_observation',
          content: result.relationshipObservations.join('；'),
          tags: result.relationshipObservations,
          date: timestampMap.values().next().value || new Date().toISOString(),
          batchId: result.batchId,
          createdAt: Date.now()
        });
      }

      if (memories.length > 0) {
        await this.db.collection('user_memories').insertMany(memories);
      }

    } catch (error) {
      console.error('[VLM] Store result failed:', error);
      throw new Error(`记忆写入失败: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 保存进度
   */
  private async saveProgress(progress: AnalysisProgress): Promise<void> {
    if (!this.db) return;

    try {
      await this.db.collection('vlm_analysis_progress').updateOne(
        { userId: progress.userId },
        { $set: progress },
        { upsert: true }
      );
    } catch (error) {
      console.error('[VLM] Save progress failed:', error);
    }
  }
}

// 导出单例
export const vlmAnalysisService = new VLMAnalysisService();
