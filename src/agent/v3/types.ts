/**
 * Pixel Beat Agent V3 - 类型定义
 * 双层架构：对话层 (Pixel Beat) + 执行层 (Execution Agent)
 */

// ==================== 消息类型 ====================

export type MessageType =
  | 'user_message'        // 用户消息（最高优先级）
  | 'execution_result'    // 执行层返回
  | 'system_context'      // 系统上下文
  | 'scheduled_trigger'   // 定时触发
  | 'conversation_summary'; // 对话摘要

export interface Message {
  type: MessageType;
  content: any;
  timestamp: number;
  metadata?: Record<string, any>;
}

// ==================== 任务类型 ====================

export interface Task {
  id: string;
  goal: string;
  context: Record<string, any>;
  priority: 'high' | 'normal' | 'low';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
}

export interface TaskResult {
  taskId: string;
  status: 'success' | 'error' | 'partial';
  results: any;
  recommended?: string;
  reasoning?: string;
  executionTimeMs: number;
}

// ==================== 故事类型 ====================

export interface Story {
  id: string;
  title: string;
  body: string;
  angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast';
  style: 'natural' | 'literary' | 'humorous' | 'gossip' | 'warm' | 'mysterious';
  score?: number;
  viralBreakdown?: ViralBreakdown;
  createdAt: number;
}

export interface ViralBreakdown {
  gossip: number;
  hotness: number;
  status: number;
  class: number;
  memoryDepth: number;
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

export interface AgentV3Input {
  userId: string;
  photos: Array<{
    base64: string;
    mimeType?: string;
    photoId?: string;
  }>;
  existingPersona?: any;
  preferredStyle?: 'natural' | 'literary' | 'humorous';
  generateStory?: boolean;
}

export interface AgentV3Output {
  status: 'success' | 'error' | 'pending_confirmation';

  // 故事相关
  story?: Story;
  storyPreview?: StoryPreview;
  alternatives?: Story[];

  // 分析结果
  photoAnalysis?: any;
  memoryConnections?: Array<{
    angleType: string;
    memoryId: string;
    description: string;
    confidence: number;
  }>;

  // 执行信息
  reasoning?: {
    memoryDecision: string;
    memoryUsed: boolean;
    strategyChoice: string;
    strategyReason: string;
  };

  // 互动预测
  engagementScore?: number;
  viralBreakdown?: ViralBreakdown;
  likelyReactions?: string[];

  // 错误
  error?: string;

  // 调试
  debug?: {
    dialogueSteps: string[];
    executionSteps: string[];
    totalTokens: number;
    totalLatencyMs: number;
    dialogueTurns: number;
    executionTurns: number;
  };
}

// ==================== 确认状态 ====================

export interface ConfirmationState {
  storyId: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'modified';
  feedback?: string;
  modifiedStory?: Story;
}

// ==================== Subagent 类型 ====================

export interface SubagentTask {
  id: string;
  goal: string;
  tools: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
}

export interface SubagentResult {
  subagentId: string;
  status: 'success' | 'error';
  result: any;
  executionTimeMs: number;
}

// ==================== 工具定义 ====================

// 对话层工具
export interface DialogueTools {
  dispatch_task: (goal: string, context: Record<string, any>, priority?: 'high' | 'normal' | 'low') => Promise<TaskResult>;
  display_story: (storyId: string, prompt?: string, showAlternatives?: boolean) => Promise<StoryPreview>;
  ask_user: (question: string, context: string, options?: string[]) => Promise<string>;
  notify_user: (message: string, type: 'progress' | 'discovery' | 'insight' | 'completion') => void;
  publish_story: (storyId: string) => Promise<{ success: boolean; publishedAt: number }>;
}

// 执行层工具
export interface ExecutionTools {
  analyze_photos: (images: Array<{ base64: string; mimeType: string }>) => Promise<any>;
  retrieve_memories: (photoAnalysis: any, paths?: string[], topK?: number) => Promise<any>;
  generate_story: (analysis: any, memories: any[], angle: string, style: string) => Promise<Story>;
  predict_engagement: (storyId: string) => Promise<any>;
  transform_style: (storyId: string, targetStyle: string) => Promise<Story>;
  spawn_subagent: (goal: string, tools: string[]) => Promise<SubagentResult>;
}
