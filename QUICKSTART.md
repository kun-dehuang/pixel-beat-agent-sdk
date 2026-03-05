# 快速开始指南

## 5 分钟上手 Pixel Beat Agent SDK

### 第一步：安装依赖

```bash
cd pixel-beat-agent-sdk
npm install
```

### 第二步：体验 Mock 模式（无需 API Keys）

```bash
npx ts-node tests/quick-start.test.ts
```

这会运行所有核心功能的 Mock 版本，让你快速了解 SDK 的能力。

### 第三步：配置真实 API Keys

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 必需
ANTHROPIC_API_KEY=sk-ant-xxxxx
GEMINI_API_KEY=AIzaSyxxxxx

# 可选
# MNEMONIC_SERVICE_URL=http://localhost:5000
```

### 第四步：运行真实测试

```bash
# V3 SDK 测试
npm run test:v3

# V3 双层架构测试
npm run test
```

### 第五步：在你的代码中使用

```typescript
import { PaparazziOrchestrator } from './src/agent/v3-sdk';

const orchestrator = new PaparazziOrchestrator();

const result = await orchestrator.run(
  {
    userId: 'user_123',
    photos: [{
      base64: fs.readFileSync('photo.jpg').toString('base64'),
      mimeType: 'image/jpeg'
    }]
  },
  (event) => console.log(event.message)  // 进度回调
);

console.log(result.story);
```

## 常见问题

### Q: 测试时报错 "Missing API Key"？
A: 请确保 `.env` 文件存在且包含有效的 API Keys

### Q: 如何调试？
A: 设置 `NODE_ENV=development` 可以看到更详细的日志

### Q: 可以离线测试吗？
A: 可以，使用 `src/mocks/mock-services.ts` 中的 Mock 服务

## 下一步

- 查看 `examples/` 目录了解更多用法
- 阅读 `docs/` 目录了解架构设计
- 修改 `src/agent/v3-sdk/prompt-config.ts` 自定义 Prompt
