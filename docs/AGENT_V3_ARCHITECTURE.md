# Pixel Beat Agent V3 - 双层架构设计

> 整合 Poke 双层 Agent 架构 + Manus 事件流 + Mnemonic Director 7步流水线

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              用户 (APP)                                  │
│                        上传照片 / 查看故事 / 互动                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│                    Pixel Beat (对话层 / Personality Agent)               │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                           │
│  身份: AI 狗仔队，以第三人称视角报道用户生活                               │
│                                                                           │
│  职责:                                                                    │
│  • 理解用户意图，解读照片背后的故事潜力                                    │
│  • 拆分任务，分发给 Execution Agent（只说 WHAT，不说 HOW）                 │
│  • 汇总执行结果，用狗仔队口吻呈现给用户                                    │
│  • 管理确认节点（故事预览、发布确认）                                      │
│  • 维护对话人格（有趣、八卦、温暖）                                        │
│                                                                           │
│  工具: dispatch_task, display_story, ask_user, notify_user               │
│                                                                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │ dispatch_task
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                           │
│                    Execution Agent (执行层 / 执行引擎)                    │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                           │
│  职责:                                                                    │
│  • 执行具体任务（图片分析、记忆检索、故事生成、评分预测）                   │
│  • 并行 spawn 多个 subagent 加速执行                                      │
│  • 返回结构化结果给 Pixel Beat（含 storyId, scoreId 等）                  │
│  • 不直接与用户交互                                                       │
│                                                                           │
│  工具: analyze_photos, retrieve_memories, generate_story,                │
│        predict_engagement, transform_style, spawn_subagent               │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、API 接口

### POST /api/agent/v3/run

运行 V3 双层 Agent，完成照片分析和故事生成。

**请求**:
```json
{
  "userId": "user_123",
  "photos": [
    {
      "base64": "/9j/4AAQSkZJRg...",
      "mimeType": "image/jpeg"
    }
  ],
  "existingPersona": { ... },  // 可选
  "preferredStyle": "natural"  // 可选: natural | literary | humorous
}
```

**响应**:
```json
{
  "status": "pending_confirmation",
  "story": {
    "id": "story_1707235200000_0",
    "title": "从996到下午茶",
    "body": "两周前她还在工位上吃外卖...",
    "angle": "emotion_peak",
    "style": "natural",
    "score": 8.2,
    "viralBreakdown": {
      "gossip": 8.0,
      "hotness": 9.0,
      "status": 8.0,
      "class": 8.5,
      "memoryDepth": 9.0
    }
  },
  "storyPreview": {
    "storyId": "story_1707235200000_0",
    "predictedEngagement": {
      "likes": 32,
      "comments": 16,
      "likelyReactions": ["发生了什么？", "太懂了", "抱抱"]
    },
    "alternatives": [...]
  },
  "photoAnalysis": { ... },
  "memoryConnections": [ ... ],
  "reasoning": {
    "memoryDecision": "检索到相关记忆",
    "memoryUsed": true,
    "strategyChoice": "emotion_peak",
    "strategyReason": "情绪反差角度评分最高"
  },
  "engagementScore": 8.2,
  "debug": {
    "dialogueSteps": ["notify_user", "dispatch_task", "display_story"],
    "dialogueTurns": 3,
    "executionTurns": 1,
    "totalTokens": 5000,
    "totalLatencyMs": 8000
  }
}
```

### POST /api/agent/v3/confirm

确认或拒绝故事。

**请求**:
```json
{
  "userId": "user_123",
  "storyId": "story_xxx",
  "confirmed": true,
  "feedback": "可选的反馈内容"
}
```

**响应**:
```json
{
  "success": true,
  "message": "已发布！坐等朋友们的反应吧 👀"
}
```

### GET /api/agent/v3/health

V3 Agent 健康检查。

**响应**:
```json
{
  "status": "ok",
  "version": "v3",
  "architecture": "dual-layer",
  "activeSessions": 5,
  "timestamp": "2026-02-06T13:48:00.000Z"
}
```

---

## 三、核心设计模式

### 3.1 只说 WHAT 不说 HOW

对话层分发任务时，只描述目标，不指定方法：

```
✅ 正确：
- "分析这批照片中的情绪变化和隐形炫耀点"
- "找到与当前照片情绪反差最大的历史记忆"
- "为这个场景生成 3 个不同角度的故事版本"

❌ 错误：
- "调用 analyze_photos 工具..."
- "使用 4-Path 检索..."
- "用 gossip 风格生成..."
```

### 3.2 确认节点机制

```
生成故事 → display_story(预览) → 用户确认 → publish_story(发布)
                                    ↓
                              👎 → dispatch_task("换角度重新生成")
```

### 3.3 并行执行

执行层支持并行 spawn 多个子任务：

```typescript
// 多角度故事生成
spawn_subagent("以隐形炫耀角度生成故事")
spawn_subagent("以情绪反常角度生成故事")
spawn_subagent("以分享价值角度生成故事")
→ 3 个 subagent 并行执行
```

---

## 四、工具定义

### 对话层工具

| 工具 | 描述 |
|------|------|
| `dispatch_task` | 向执行层分发任务 |
| `display_story` | 展示故事预览 |
| `notify_user` | 向用户发通知 |

### 执行层工具

| 工具 | 描述 |
|------|------|
| `analyze_photos` | VLM 图片分析 |
| `retrieve_memories` | 4-Path 记忆检索 |
| `generate_story` | 故事生成 |
| `predict_engagement` | 5维评分 + 互动预测 |
| `transform_style` | 风格转换 |
| `spawn_subagent` | 并行子任务 |

---

## 五、与 V2 对比

| 特性 | V2 (单层) | V3 (双层) |
|-----|----------|----------|
| **架构** | 单 Agent + 工具 | 对话层 + 执行层 |
| **任务分发** | Agent 直接调用工具 | 只说 WHAT 不说 HOW |
| **并行能力** | 工具级别并行 | subagent 级别并行 |
| **确认机制** | 无 | display_story 预览 |
| **人格维护** | 可能被工具调用打断 | 对话层专注人格 |

---

## 六、文件结构

```
src/agent/v3/
├── index.ts              # 模块导出
├── types.ts              # 类型定义
├── pixel-beat.agent.ts   # 对话层 Agent
└── execution.agent.ts    # 执行层 Agent

src/routes/
└── agent.routes.ts       # API 路由 (包含 /v3 端点)
```

---

*文档版本: 3.0*
*最后更新: 2026-02-06*
