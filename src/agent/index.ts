/**
 * Agent 模块导出
 */

// V2 单层架构
export { PixelBeatAgent, AgentInput, AgentOutput } from "./pixel-beat.agent";
export {
  STRATEGY_TEMPLATES,
  selectBestStrategy,
  getStrategyTemplate,
  checkStoryQuality,
  type StrategyType,
  type StrategyTemplate
} from "./strategies";

// V3 双层架构
export { PixelBeatAgentV3, ExecutionAgent } from "./v3";
export type { AgentV3Input, AgentV3Output, Story, StoryPreview, ViralBreakdown } from "./v3";

// V3 SDK (Paparazzi Pipeline)
export { PaparazziOrchestrator } from "./v3-sdk";
export type { AgentInput as AgentSDKInput, AgentOutput as AgentSDKOutput } from "./v3-sdk";
