/**
 * Pixel Beat Agent SDK - 主入口
 *
 * @module pixel-beat-agent-sdk
 */

// ==================== V3 SDK (推荐使用) ====================

export {
  PaparazziOrchestrator
} from './agent/v3-sdk/paparazzi-orchestrator';

export {
  MemoryTraceAgent
} from './agent/v3-sdk/memory-trace-agent';

export {
  promptConfigManager
} from './agent/v3-sdk/prompt-config';

// ==================== V3 双层架构 ====================

export {
  PixelBeatAgentV3
} from './agent/v3/pixel-beat.agent';

export {
  ExecutionAgent
} from './agent/v3/execution.agent';

// ==================== 工具集 ====================

export {
  ToolHandlers,
  AnalyzePhotosSchema,
  GeneratePersonaSchema,
  GenerateStorySchema,
  EvaluateQualitySchema,
  RetrieveMemoriesSchema,
  PredictEngagementSchema
} from './tools';

// ==================== 类型定义 ====================

export type {
  // V3 SDK Types
  AgentInput,
  AgentOutput,
  Story,
  ExpertScores,
  StoryPreview,
  PhotoInput,
  PhotoExif,
  PaparazziImageAnalysis,
  PaparazziUserProfile,
  PaparazziMemoryContext,
  PaparazziRelationshipContext,
  ExpertIntent,
  FlexIntent,
  VibeIntent,
  GossipIntent,
  ExpertResults,
  CopyCandidate,
  AgentStepEvent,
  MemoryTraceInput,
  MemoryTraceOutput,
  TraceAnchorResult,
  // V3 Dual-Layer Types
  AgentV3Input,
  AgentV3Output,
  Task,
  TaskResult,
  ConfirmationState,
  // Tool Types
  AnalyzePhotosInput,
  GeneratePersonaInput,
  GenerateStoryInput,
  EvaluateQualityInput,
  RetrieveMemoriesInput,
  PredictEngagementInput
} from './agent/v3-sdk/types';

// ==================== 常量 ====================

export const VERSION = '1.0.0';
export const ARCHITECTURE = 'dual-layer';
