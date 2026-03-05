
export interface ImageAnalysis {
  objects: string[];
  setting: string;
  atmosphere: string;
  colors: string[];
  keyDetails: string[];
}

export interface ExifData {
  dateTime?: string;    // 拍摄时间
  location?: string;    // GPS位置（格式：31.2304°N 121.4737°E）
  make?: string;
  model?: string;
  exposureTime?: string;
  fNumber?: string;
  iso?: string;
  focalLength?: string;
  software?: string;
}

export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
  module: string;
  timestamp: number;
}

export interface BatchImage {
  id: string;
  url: string;
  analysis: string; 
  exif?: ExifData;
}

export interface LogEntry {
  module: string;
  prompt: string;
  output: string;
  timestamp: number;
  usage?: TokenUsage;
}

export interface GenerationLog {
  id: string;
  timestamp: number;
  imageUrl?: string;
  entries: LogEntry[];
}

export interface Photo {
  id: string;
  userId: string;
  userName: string;
  imageUrl: string;
  uploadTime: number;
  exif?: ExifData;
  aiAnalysis?: {
    tags: string[];
    description: string;
  };
}

export interface SocialCopy {
  options: string[];
  rationale: string;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface CopySet {
  timestamp: number;
  options: string[];
  rationale?: string;
  versionName?: string; // Track which version generated this
}

export interface DataVersion {
  id: string;
  timestamp: number;
  summary: string;
  data: SessionData;
}

/**
 * Encapsulates the prompt configuration which can be versioned
 */
export interface PromptConfig {
  id: string;
  name: string;
  personaPrompt: string;
  stylePrompt: string;
  analysisPrompt: string;
  batchAnalysisPrompt: string;
  chatInstructionPrompt: string;
  timestamp: number;
}

export interface SessionData {
  // Current working prompts
  personaPrompt: string;
  stylePrompt: string;
  analysisPrompt: string;
  batchAnalysisPrompt: string;
  chatInstructionPrompt: string;

  // Shared across versions
  batchAnalysisResult: string;
  batchImages: BatchImage[];
  analysis: ImageAnalysis | null;
  analysisExif?: ExifData;

  // Outputs
  copySets: CopySet[];
  chatHistory: ChatMessage[];
  lastImageUrl: string | null;
  usageHistory: TokenUsage[];
  generationLogs: GenerationLog[];

  // ✅ 新增：多故事数据
  multiStoryData: MultiStoryData | null;
}

export interface UserAccount {
  id: string;
  name: string;
  avatar: string;
  data: SessionData;
  versions?: DataVersion[]; // Data state versions (history)
  promptVersions?: PromptConfig[]; // User-named prompt templates
}

export type TabType = 'creation' | 'memory' | 'debug' | 'consumption' | 'observation' | 'batch_test';
export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

// ✅ 新增：多故事相关类型
export interface MultiStoryData {
  total_stories: number;
  stories: StoryItem[];
  summary: string;
}

export interface StoryItem {
  story_id: number;
  theme: string;
  image_ids: string[];
  moment_result: any;
}
