/**
 * Pixel Beat Agent V3 SDK - 类型定义
 * 使用 Anthropic Agent SDK 的双层架构
 */

// ==================== 故事类型 ====================

export interface Story {
  id: string;
  title: string;
  body: string;
  angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast';
  style: 'natural' | 'literary' | 'humorous' | 'gossip' | 'warm' | 'mysterious';
  score?: number;
  expertScores?: ExpertScores;
  createdAt: number;
}

/** 专家原始评分透传 (替代旧的 ViralBreakdown 5维评分) */
export interface ExpertScores {
  flex?: {
    category: string;        // 6维之一: 资源装逼 | 关系装逼 | 魅力与自我展示 | 社交地位 | 生活方式 | 态度装逼
    subcategory: string;
    dimension_score: number; // 1-5，炫耀的相对强度
    confidence: number;      // 0-1
    core_narrative: string;
  };
  vibe?: {
    vibe_type: string;       // 孤独/内省 | 放松/享受 | 庆祝/狂欢 | 压力/疲惫 | 专注/平静 | 浪漫/甜蜜
    emotional_tone: string;
    strength: number;        // 0-1，氛围强烈程度
    confidence: number;      // 0-1
    core_narrative: string;
  };
  gossip?: {
    gossip_type: string;     // 新关系 | 反常行为 | 神秘线索
    social_dynamics: string;
    confidence: number;      // 0-1
    core_narrative: string;
  };
}

export interface StoryPreview {
  storyId: string;
  story: Story;
  predictedEngagement: {
    likes: number;
    comments: number;
    likelyReactions: string[];
  };
  alternatives?: Story[];
}

// ==================== Agent 输入输出 ====================

// EXIF 元数据
export interface PhotoExif {
  dateTime?: string;           // 拍摄时间 "2024-01-15 14:30:00"
  latitude?: number;           // GPS 纬度
  longitude?: number;          // GPS 经度
  locationName?: string;       // 地点名称（iOS 反向地理编码）
  deviceModel?: string;        // 设备型号 "iPhone 15 Pro"
  lensModel?: string;          // 镜头信息
  focalLength?: number;        // 焦距 mm
  aperture?: number;           // 光圈 f/1.8
  exposureTime?: string;       // 快门 "1/120"
  iso?: number;                // ISO
  width?: number;              // 图片宽度
  height?: number;             // 图片高度
}

export interface PhotoInput {
  base64: string;
  mimeType?: string;
  localIdentifier?: string;  // iOS PHAsset.localIdentifier - 用于去重
  creationDate?: string;     // ISO 8601 格式，e.g. "2025-12-15T14:30:00+08:00"
  exif?: PhotoExif;
}

export interface AgentInput {
  userId: string;
  photos: PhotoInput[];
  existingPersona?: any;
  preferredStyle?: 'natural' | 'literary' | 'humorous';
}

export interface AgentOutput {
  status: 'success' | 'error' | 'pending_confirmation';
  story?: Story;
  storyPreview?: StoryPreview;
  alternatives?: Story[];
  photoAnalysis?: any;
  memoryConnections?: any[];
  reasoning?: {
    memoryDecision: string;
    memoryUsed: boolean;
    strategyChoice: string;
    strategyReason: string;
  };
  engagementScore?: number;
  expertScores?: ExpertScores;
  error?: string;
  debug?: {
    agentSteps: string[];
    stepDetails?: Array<{
      turn: number;
      tool: string;
      startTime: number;
      durationMs: number;
      inputTokens: number;
      outputTokens: number;
      input: any;
      output: string;
    }>;
    totalTokens: number;
    totalLatencyMs: number;
    agentTurns: number;
  };
}

// ==================== SSE 步骤事件 ====================

export interface AgentStepEvent {
  type: 'agent_start' | 'tool_start' | 'tool_done' | 'agent_complete';
  step: number;
  tool?: string;
  message: string;
  timestamp: number;
  turn?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

// ==================== Paparazzi V3 管线类型 ====================

/** VLM 图像分析结果 (V3 本地版对齐) */
export interface PaparazziImageAnalysis {
  summary: string;           // 一句话描述照片内容 (20-50字)
  mood: string;              // 整体情绪 (2-4个形容词)
  vibes: string[];           // 氛围关键词 (3-5个)
  weather: {
    condition: string | null;  // 特殊天气，无则 null
    rarity: 'normal' | 'special';
    visual_elements: string[];
  };
  macro_event: {
    event_type: string;      // 聚会/工作/运动/旅行/日常/家庭/其他
    activity: string;
    social_context: string;  // 独自/情侣/朋友/家庭/商务
  };
  brands: string[];
  violations: string[];      // alcohol, tobacco, tattoo
  people: {
    count: number;
    genders: string[];
    age_group: string;       // 儿童/少年/青年/中年/老年
    composition: string;     // 自拍/他拍/合影/特写/静物/风景
    pose: string;
    gaze: string;
    facial_expression: string;
    demeanor: string;
    emotions: string[];
    actions: string[];
    body_display: {
      has_muscle: boolean;
      has_skin_showcase: boolean;
      fitness_level: string;
      body_type: string;
      posture: string;
      body_features?: string[];
      fitness_evidence?: string[];
    };
  };
  scene: {
    location_detected: string;
    location_type: string;   // 室内/室外
    visual_clues: string[];
    environment_details: string[];
  };
  clothing: {
    description: string;
    items: string[];
    style: string;
  };
  story_hints: string[];
  // 保留原始 VLM 输出供调试
  raw?: any;
}

/** 4-Path 记忆检索上下文 */
export interface PaparazziMemoryContext {
  /** 最匹配的叙事角度 (按置信度排序) */
  top_angles: Array<{
    angle_type: string;      // entity_bridge | emotion_echo | emotion_contrast | location_memory | person_story
    angle_name: string;      // e.g., "物品延续: 咖啡杯"
    confidence: number;      // 0-1
    description: string;
    matched_items?: string[];
    memory_date?: string;
    memory_content?: string; // 截断到 200 字
  }>;
  total_matches: number;
  active_paths: string[];    // ["entity", "emotion", "location", "person"]
}

/** 人物关系上下文 */
export interface PaparazziRelationshipContext {
  /** 匹配到照片中人物的关系 */
  matched_relationships: Array<{
    person: string;
    role: string;             // 朋友/家人/伴侣/同事
    nickname?: string;
    closeness_level: string;  // 亲密/熟悉/一般
    trend: string;            // 越来越近/稳定/渐行渐远/新认识
    shared_experiences: string[];
    first_seen?: string;
    last_seen?: string;
  }>;
  /** 相关关键事件 */
  relevant_key_events: Array<{
    date: string;
    event: string;
    significance: string;
  }>;
  has_relationships: boolean;
}

/** 用户画像 (结构化) + 记忆 + 关系 */
export interface PaparazziUserProfile {
  age?: number;
  gender?: string;
  interests?: string[];
  typical_brands?: string[];
  personality?: string[];
  consumption_level?: string;
  persona_raw?: string;  // 原始 persona 文本
  memory_context?: PaparazziMemoryContext;
  relationship_context?: PaparazziRelationshipContext;
}

// ==================== 统一 Intent 类型 (V3 本地版对齐) ====================

/** Expert Intent 基础接口 — 所有专家输出统一为 { intents: ExpertIntent[] } */
export interface ExpertIntent {
  record_type: string;       // "炫耀" | "氛围" | "八卦"
  confidence: number;        // 0-1
  core_narrative: string;
}

/** FlexExpert 炫耀意图 */
export interface FlexIntent extends ExpertIntent {
  analysis: {
    category: string;        // 6维之一: 资源装逼 | 关系装逼 | 魅力与自我展示 | 社交地位 | 生活方式 | 态度装逼
    subcategory: string;
    dimension_score: number; // 1-5 整数，炫耀的相对强度
    reason: string;
    evidence_from_image: string[];
  };
}

/** VibeExpert 氛围意图 */
export interface VibeIntent extends ExpertIntent {
  analysis: {
    vibe_type: string;       // 孤独/内省 | 放松/享受 | 庆祝/狂欢 | 压力/疲惫 | 专注/平静 | 浪漫/甜蜜
    emotional_tone: string;
    strength: number;        // 0-1，氛围强烈程度
    reason: string;
    evidence_from_image: string[];
  };
}

/** GossipExpert 八卦意图 */
export interface GossipIntent extends ExpertIntent {
  analysis: {
    gossip_type: string;     // 新关系 | 反常行为 | 神秘线索
    social_dynamics: string;
    reason: string;
    evidence_from_image: string[];
  };
}

/** 专家分析结果集合 — intents[] 数组格式 */
export interface ExpertResults {
  flex?: { intents: FlexIntent[] };
  vibe?: { intents: VibeIntent[] };
  gossip?: { intents: GossipIntent[] };
}

/** CopyGenerator 文案结果 — 每个 intent 独立调用生成一条 */
export interface CopyCandidate {
  copy: string;            // Gen Z caption (15 words max)
  intent_type: string;     // 炫耀 | 氛围 | 八卦
  intent: ExpertIntent;    // 关联的 expert intent
}

/** 管线步骤详情 (用于 debug) */
export interface PipelineStepDetail {
  step: string;            // 步骤名
  model: string;           // 使用的模型
  startTime: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  input: any;
  output: any;
}

// ==================== 工具参数类型 ====================

export interface AnalyzePhotosParams {
  focus?: 'general' | 'emotion' | 'social' | 'activity';
}

export interface RetrieveMemoriesParams {
  photoAnalysis: any;
  paths?: string[];
  topK?: number;
}

export interface GenerateStoryParams {
  analysis: any;
  memories?: any[];
  angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast';
  style?: 'natural' | 'literary' | 'humorous' | 'gossip' | 'warm' | 'mysterious';
}

export interface PredictEngagementParams {
  story: {
    title: string;
    body: string;
  };
  hasMemoryConnection?: boolean;
}

// ==================== Memory Trace 类型 ====================

export interface MemoryTraceInput {
  userId: string;
  photos: PhotoInput[];
  candidatePhotoIds?: string[];   // 用户相册中候选照片的 localIdentifier
  personaSummary?: string;        // 可选的 persona 上下文
}

export interface TraceAnchorResult {
  id: string;
  label: string;
  centerX: number;     // 归一化坐标 0...1
  centerY: number;
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  matchedPhotoAssetId?: string;
  matchSimilarity?: number;
  matchedLabel?: string;
  narrativeTitle?: string;
  narrativeScript?: string;
  emotionTone?: string;
}

export interface PhotoTraceOutput {
  photoAssetId: string;
  anchors: TraceAnchorResult[];
  status: 'completed' | 'no_anchors' | 'error';
  error?: string;
}

export interface MemoryTraceOutput {
  status: 'success' | 'error';
  photoResults: PhotoTraceOutput[];
  debug?: {
    agentSteps: string[];
    stepDetails?: any[];
    totalTokens: number;
    totalLatencyMs: number;
    agentTurns: number;
  };
  error?: string;
}
