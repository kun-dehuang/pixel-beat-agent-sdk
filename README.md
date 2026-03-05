# Pixel Beat Agent SDK

照片分析与故事生成 Agent 框架 - 独立迭代版本

## 📁 项目结构

```
pixel-beat-agent-sdk/
├── src/
│   ├── agent/              # Agent 核心代码
│   │   ├── v3/             # V3 双层架构 (对话层 + 执行层)
│   │   │   ├── pixel-beat.agent.ts    # 对话层 Agent
│   │   │   ├── execution.agent.ts     # 执行层 Agent
│   │   │   └── types.ts              # 类型定义
│   │   └── v3-sdk/          # V3 SDK 版本 (Anthropic Agent SDK)
│   │       ├── paparazzi-orchestrator.ts  # 固定管线编排器
│   │       ├── memory-trace-agent.ts      # 记忆追踪 Agent
│   │       ├── prompt-config.ts           # Prompt 配置管理
│   │       └── types.ts                  # SDK 类型定义
│   ├── tools/             # 工具集 (VLM 调用、记忆检索等)
│   ├── services/          # 核心服务
│   └── mocks/             # Mock 服务 (用于测试)
├── tests/                 # 测试用例
├── examples/              # 使用示例
└── config/                # 配置文件
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd pixel-beat-agent-sdk
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的 API Keys
```

### 3. 运行测试

```bash
# V3 双层架构测试
npm run test

# V3 SDK 固定管线测试
npm run test:v3

# 记忆追踪测试
npm run test:memory-trace
```

## 🏗️ 架构说明

### V3 双层架构

```
┌─────────────────────────────────────────┐
│   Pixel Beat (对话层)                    │
│   • 理解用户意图                         │
│   • 分发任务（只说 WHAT，不说 HOW）       │
│   • 维护狗仔队人格                       │
└─────────────────┬───────────────────────┘
                  │ dispatch_task
                  ▼
┌─────────────────────────────────────────┐
│   Execution Agent (执行层)               │
│   • 图片分析、记忆检索                   │
│   • 故事生成、评分预测                   │
└─────────────────────────────────────────┘
```

### V3 SDK 固定管线 (5步流程)

1. **ImageAnalyzer** (Gemini VLM) - 视觉元素提取
2. **UserProfile** (数据查询) - 用户画像加载
3. **RouterAgent** (Claude Haiku) - 智能路由决策
4. **Experts** (Claude Sonnet, 并行) - Flex/Vibe/Gossip 专家
5. **CopyGenerator** (Claude Sonnet) - Gen Z Caption 生成

## 📝 主要 API

### PaparazziOrchestrator (推荐用于生产)

```typescript
import { PaparazziOrchestrator } from './src/agent/v3-sdk';

const orchestrator = new PaparazziOrchestrator();

const result = await orchestrator.run(
  {
    userId: 'user_123',
    photos: [{ base64: '...', mimeType: 'image/jpeg' }],
    preferredStyle: 'natural'
  },
  (stepEvent) => console.log(stepEvent.message)  // 进度回调
);

console.log(result.story);
```

### PixelBeatAgentV3 (双层架构)

```typescript
import { PixelBeatAgentV3 } from './src/agent/v3';

const agent = new PixelBeatAgentV3();

const result = await agent.run({
  userId: 'user_123',
  photos: [{ base64: '...', mimeType: 'image/jpeg' }],
  preferredStyle: 'natural'
});

// 处理确认
if (result.status === 'pending_confirmation') {
  await agent.handleConfirmation(result.story.id, true);
}
```

### MemoryTraceAgent (记忆追踪)

```typescript
import { MemoryTraceAgent } from './src/agent/v3-sdk';

const agent = new MemoryTraceAgent();

const result = await agent.run({
  userId: 'user_123',
  photos: [{ base64: '...', localIdentifier: 'asset_id' }],
  candidatePhotoIds: ['asset1', 'asset2']  // 候选照片
});
```

## 🔧 可配置项

### Prompt 配置

通过 `src/agent/v3-sdk/prompt-config.ts` 管理所有 Prompt：

```typescript
import { promptConfigManager } from './src/agent/v3-sdk';

// 更新专家 Prompt
promptConfigManager.updateExpert('flex', {
  systemPrompt: '你的自定义 Prompt...',
  examples: [...]
});
```

### 策略配置

在 `config/strategies/` 目录下配置故事生成策略。

## 📚 文档

- [AGENT_V3_ARCHITECTURE.md](docs/AGENT_V3_ARCHITECTURE.md) - V3 双层架构设计
- [API_DOCUMENTATION.md](docs/API_DOCUMENTATION.md) - API 接口文档
- [PIXEL_BEAT_ARCHITECTURE.md](docs/PIXEL_BEAT_ARCHITECTURE.md) - 整体架构

## 🧪 测试数据

测试用例位于 `tests/` 目录：

- `run-agent.test.ts` - V3 双层架构测试
- `v3-sdk.test.ts` - SDK 固定管线测试
- `memory-trace.test.ts` - 记忆追踪测试

## 🔑 依赖的 API 服务

| 服务 | 用途 | 是否必需 |
|------|------|----------|
| Anthropic Claude | Agent 核心、故事生成 | ✅ 必需 |
| Google Gemini | VLM 图像分析 | ✅ 必需 |
| Mnemonic Director | 记忆检索 | ⚪ 可选 |
| ai-moments | 备用 VLM 服务 | ⚪ 可选 |

## 📦 迭代指南

### 修改 Agent 行为

1. **修改 Prompt** → 编辑 `src/agent/v3-sdk/prompt-config.ts`
2. **修改管线流程** → 编辑 `src/agent/v3-sdk/paparazzi-orchestrator.ts`
3. **添加新工具** → 在 `src/tools/` 添加，然后在 Agent 中注册
4. **修改策略** → 编辑 `src/agent/strategies.ts`

### 测试你的修改

```bash
# 1. 编译
npm run build

# 2. 运行测试
npm run test

# 3. 查看日志输出，验证行为
```

## 🚧 已知限制

1. **内存依赖** - 当前版本依赖外部记忆服务，可以启用 Mock 模式测试
2. **图片大小** - 单张图片建议 < 5MB
3. **并发限制** - 建议每用户最多 3 个并发请求

## 📄 License

ISC
