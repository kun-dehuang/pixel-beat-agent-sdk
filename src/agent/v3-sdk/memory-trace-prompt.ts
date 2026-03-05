/**
 * Memory Trace Agent - Prompt 配置
 *
 * 专用于记忆溯源分析的 system prompt 和 tool 定义
 * 工作流：识别照片中有故事价值的物体 → 跨时间匹配 → 生成溯源叙事
 */

import Anthropic from "@anthropic-ai/sdk";

// ==================== System Prompt ====================

export const MEMORY_TRACE_SYSTEM_PROMPT = `你是 Pixel Beat 记忆溯源分析师。

你的使命是基于 Gemini VLM 的视觉预分析结果，结合用户记忆，为照片中有"故事价值"的物体生成溯源叙事。

**重要：你不会直接看到照片图片。Gemini VLM 已经预先分析了照片内容，结果以文本形式提供在用户消息中。请基于这些预分析结果进行编排。**

## 工作目标
1. 基于 VLM 预分析结果，筛选**最有故事价值的元素**
2. 结合用户 persona 和记忆，判断哪些元素对**这个用户**有特殊意义
3. 为每个有价值的锚点生成**跨时间的溯源叙事**

## 判断"故事价值"的标准
- **情感锚点**：承载特殊情感的物品（礼物、纪念品、宠物）
- **关系见证**：出现在人物互动中的标志物（合影地点、共同爱好的物品）
- **时间印记**：能体现变化和成长的元素（同一地点不同时间、装扮变化）
- **生活方式**：反映用户个性和习惯的特征（常去的咖啡店、固定的运动装备）

## 重要原则
- 每张照片最多标记 **3 个锚点**（精选最有价值的）
- **只要 VLM 识别出有故事潜力 (storyPotential > 0.3) 的物体，就必须生成锚点**
- 即使 search_memory_matches 返回 0 条记忆，也要为高潜力物体生成锚点
- 没有记忆匹配时，基于照片本身的视觉故事价值生成叙事（场景联想、物品故事、人物观察）
- 坐标使用 **归一化值 (0-1)**，来自 VLM 预分析的坐标
- 叙事脚本 **30-60 字**，第三人称，要有时间感和情感温度
- **人物 > 地点 > 物品**

## 工作流程（严格按顺序）
1. **get_persona** - 获取用户人设（了解用户才能判断什么对TA有价值）
2. **analyze_photo_objects** - 获取详细的物体识别结果（VLM 预分析数据）
3. **search_memory_matches** - 在记忆中搜索跨时间关联（可能为空，这是正常的）
4. **generate_trace_narratives** - 为有价值的锚点生成溯源叙事（**不能传空 anchors！VLM 识别出的物体必须传入**）

**关键：即使第3步没有找到记忆，第4步仍然必须把 VLM 识别的高潜力物体作为 anchors 传入。**

完成后立即结束，不要多余对话。

## 输出格式
完成所有工具调用后，不需要输出任何文字，直接结束即可。结果已通过 generate_trace_narratives 工具返回。`;

// ==================== Tool Definitions ====================

export interface MemoryTraceToolConfig {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  progressMessage: string;
}

export const MEMORY_TRACE_TOOLS: MemoryTraceToolConfig[] = [
  {
    name: "get_persona",
    description: "获取用户的人设画像总结，了解用户是谁、喜欢什么、经历过什么。这是判断什么对用户有故事价值的基础。",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: []
    },
    progressMessage: "👤 正在获取用户画像..."
  },
  {
    name: "analyze_photo_objects",
    description: "获取 Gemini VLM 预分析的物体识别结果。返回每张照片中有故事价值的物体列表，包含标签、位置坐标（归一化）、故事潜力评分。数据已由 Gemini 2.0 Flash 预先生成。",
    inputSchema: {
      type: "object" as const,
      properties: {
        focusAreas: {
          type: "array",
          items: { type: "string" },
          description: "重点关注的区域类型: 'people', 'objects', 'places', 'pets'"
        }
      },
      required: []
    },
    progressMessage: "🔍 正在识别照片中的关键元素..."
  },
  {
    name: "search_memory_matches",
    description: "在用户记忆中搜索与识别到的物体/场景相关的跨时间关联。返回匹配的记忆片段、时间跨度、情感变化。",
    inputSchema: {
      type: "object" as const,
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "物体/场景标签" },
              category: { type: "string", description: "类别: person, object, place, pet, activity" },
              storyPotential: { type: "number", description: "故事潜力 0-1" }
            }
          },
          description: "从 analyze_photo_objects 得到的候选锚点"
        }
      },
      required: ["candidates"]
    },
    progressMessage: "🧠 正在搜索跨时间记忆关联..."
  },
  {
    name: "generate_trace_narratives",
    description: "为有价值的锚点生成溯源叙事脚本。结合物体分析、记忆匹配、用户人设，生成有时间感和情感温度的短叙事。**重要：必须将 VLM 识别出的高潜力物体传入 anchors，即使 search_memory_matches 返回空结果也不能传空数组。**",
    inputSchema: {
      type: "object" as const,
      properties: {
        anchors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              centerX: { type: "number", description: "归一化 X 坐标 0-1" },
              centerY: { type: "number", description: "归一化 Y 坐标 0-1" },
              bboxX: { type: "number" },
              bboxY: { type: "number" },
              bboxWidth: { type: "number" },
              bboxHeight: { type: "number" },
              memoryContext: { type: "string", description: "相关记忆片段" },
              emotionShift: { type: "string", description: "情感变化描述" }
            }
          },
          description: "确定的锚点列表（含位置和记忆上下文）"
        }
      },
      required: ["anchors"]
    },
    progressMessage: "✍️ 正在生成溯源叙事..."
  }
];

/**
 * 获取 Anthropic Tool 格式的工具定义
 */
export function getMemoryTraceTools(): Anthropic.Tool[] {
  return MEMORY_TRACE_TOOLS.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

/**
 * 获取工具进度消息映射
 */
export function getMemoryTraceToolMessages(): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const tool of MEMORY_TRACE_TOOLS) {
    messages[tool.name] = tool.progressMessage;
  }
  return messages;
}

/**
 * 构建用户消息
 */
export function buildMemoryTraceUserMessage(params: {
  photoCount: number;
  hasPersona: boolean;
}): string {
  return `请分析这 ${params.photoCount} 张照片，找出有故事价值的元素并生成溯源叙事。

请依次：
1. 获取用户人设画像
2. 识别照片中有故事价值的物体/场景
3. 搜索相关记忆进行跨时间匹配
4. 为有价值的锚点生成溯源叙事

每张照片最多 3 个锚点，没有故事价值的照片返回空数组。`;
}
