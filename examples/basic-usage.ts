/**
 * Pixel Beat Agent SDK - 基础使用示例
 */

import { PaparazziOrchestrator } from '../src/agent/v3-sdk';
import type { AgentInput, PhotoInput } from '../src/agent/v3-sdk/types';
import * as fs from 'fs';

/**
 * 示例 1: 单张照片分析 + 故事生成
 */
async function example1_SinglePhoto() {
  console.log('\n### 示例 1: 单张照片分析\n');

  const orchestrator = new PaparazziOrchestrator();

  // 读取本地图片并转为 base64
  const imageBuffer = fs.readFileSync('./examples/sample-photo.jpg');
  const base64 = imageBuffer.toString('base64');

  const input: AgentInput = {
    userId: 'user_123',
    photos: [{
      base64,
      mimeType: 'image/jpeg',
      localIdentifier: 'photo_001'
    }],
    preferredStyle: 'natural'
  };

  // 带 SSE 进度回调
  const result = await orchestrator.run(input, (event) => {
    console.log(`[${event.step}] ${event.message}`);
  });

  if (result.story) {
    console.log('\n生成的故事:');
    console.log(`标题: ${result.story.title}`);
    console.log(`正文: ${result.story.body}`);
    console.log(`角度: ${result.story.angle}`);
    console.log(`评分: ${result.story.score}`);
  }

  return result;
}

/**
 * 示例 2: 多张照片聚类分析
 */
async function example2_MultiPhoto() {
  console.log('\n### 示例 2: 多张照片聚类\n');

  const orchestrator = new PaparazziOrchestrator();

  const photos: PhotoInput[] = [
    { base64: '...', mimeType: 'image/jpeg', localIdentifier: 'p1' },
    { base64: '...', mimeType: 'image/jpeg', localIdentifier: 'p2' },
    { base64: '...', mimeType: 'image/jpeg', localIdentifier: 'p3' },
  ];

  const input: AgentInput = {
    userId: 'user_123',
    photos,
    preferredStyle: 'humorous'
  };

  const result = await orchestrator.run(input);

  console.log('聚类后的故事:', result.story?.title);
  return result;
}

/**
 * 示例 3: 自定义 Prompt 配置
 */
async function example3_CustomPrompt() {
  console.log('\n### 示例 3: 自定义 Prompt\n');

  import { promptConfigManager } from '../src/agent/v3-sdk';

  // 修改 FlexExpert 的 Prompt
  promptConfigManager.updateExpert('flex', {
    systemPrompt: `你是一位专业的社交媒体内容分析师。

请分析照片中的"炫耀"元素：
1. 资源装逼 - 昂贵的物品、奢华的场景
2. 关系装逼 - 与名人/权贵的合影
3. 魅力展示 - 外貌、身材、穿搭
...`,
    examples: []
  });

  // 使用新配置运行
  const orchestrator = new PaparazziOrchestrator();

  const result = await orchestrator.run({
    userId: 'user_123',
    photos: [{ base64: '...', mimeType: 'image/jpeg' }]
  });

  return result;
}

/**
 * 示例 4: 使用 V3 双层架构
 */
async function example4_DualLayerAgent() {
  console.log('\n### 示例 4: V3 双层架构\n');

  import { PixelBeatAgentV3 } from '../src/agent/v3';

  const agent = new PixelBeatAgentV3();

  const result = await agent.run({
    userId: 'user_123',
    photos: [{ base64: '...', mimeType: 'image/jpeg' }],
    preferredStyle: 'natural'
  });

  // 处理确认流程
  if (result.status === 'pending_confirmation') {
    console.log('待用户确认:', result.storyPreview?.story.title);

    const confirm = await agent.handleConfirmation(
      result.story!.id,
      true
    );

    console.log(confirm.message);
  }

  return result;
}

/**
 * 示例 5: 记忆追踪
 */
async function example5_MemoryTrace() {
  console.log('\n### 示例 5: 记忆追踪\n');

  import { MemoryTraceAgent } from '../src/agent/v3-sdk';

  const agent = new MemoryTraceAgent();

  const result = await agent.run({
    userId: 'user_123',
    photos: [{ base64: '...', localIdentifier: 'current_photo' }],
    candidatePhotoIds: ['photo_a', 'photo_b', 'photo_c']
  });

  result.photoResults.forEach(r => {
    console.log(`照片 ${r.photoAssetId}: 找到 ${r.anchors.length} 个锚点`);
    r.anchors.forEach(anchor => {
      console.log(`  - ${anchor.label} (${anchor.confidence.toFixed(2)})`);
    });
  });

  return result;
}

/**
 * 示例 6: 批量处理
 */
async function example6_BatchProcessing() {
  console.log('\n### 示例 6: 批量处理多组照片\n');

  const orchestrator = new PaparazziOrchestrator();

  const photoGroups = [
    ['photo1.jpg', 'photo2.jpg'],
    ['photo3.jpg'],
    ['photo4.jpg', 'photo5.jpg', 'photo6.jpg'],
  ];

  for (const [idx, group] of photoGroups.entries()) {
    console.log(`\n处理组 ${idx + 1}: ${group.length} 张照片`);

    const photos = group.map(path => ({
      base64: fs.readFileSync(path).toString('base64'),
      mimeType: 'image/jpeg' as const
    }));

    const result = await orchestrator.run({
      userId: 'user_123',
      photos
    });

    console.log(`  结果: ${result.story?.title || '生成失败'}`);
  }
}

// ==================== 主入口 ====================

async function main() {
  console.log('========================================');
  console.log('  Pixel Beat Agent SDK - 使用示例');
  console.log('========================================');

  // 取消注释你想运行的示例

  // await example1_SinglePhoto();
  // await example2_MultiPhoto();
  // await example3_CustomPrompt();
  // await example4_DualLayerAgent();
  // await example5_MemoryTrace();
  // await example6_BatchProcessing();

  console.log('\n✅ 示例完成');
}

main().catch(console.error);
