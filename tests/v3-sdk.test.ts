/**
 * V3 SDK PaparazziOrchestrator 测试
 *
 * 运行: npm run test:v3
 */

import * as dotenv from 'dotenv';
import { PaparazziOrchestrator } from '../src/agent/v3-sdk';
import type { AgentInput, PhotoInput } from '../src/agent/v3-sdk/types';

// 加载环境变量
dotenv.config();

/**
 * 创建测试照片输入
 */
function createTestPhoto(base64Data: string): PhotoInput {
  return {
    base64: base64Data,
    mimeType: 'image/jpeg',
    localIdentifier: `test_${Date.now()}`
  };
}

/**
 * 示例：使用占位图片测试（实际使用时替换为真实 base64）
 */
async function testWithPlaceholderImage() {
  console.log('\n=== V3 SDK 测试 ===\n');

  const orchestrator = new PaparazziOrchestrator();

  // 占位图片 - 实际测试时请替换为真实图片的 base64
  const placeholderBase64 = '/9j/4AAQSkZJRgABAQAA...'; // 简化的占位数据

  const input: AgentInput = {
    userId: 'test_user_001',
    photos: [createTestPhoto(placeholderBase64)],
    preferredStyle: 'natural'
  };

  console.log('📸 输入照片数量:', input.photos.length);
  console.log('👤 用户 ID:', input.userId);
  console.log('🎨 偏好风格:', input.preferredStyle);

  try {
    // 带 SSE 进度回调的调用
    const result = await orchestrator.run(input, (stepEvent) => {
      console.log(`  [${stepEvent.step}] ${stepEvent.message}`);
    });

    console.log('\n=== 结果 ===');
    console.log('状态:', result.status);

    if (result.story) {
      console.log('\n📖 生成的故事:');
      console.log('  标题:', result.story.title);
      console.log('  正文:', result.story.body);
      console.log('  角度:', result.story.angle);
      console.log('  风格:', result.story.style);
      console.log('  评分:', result.story.score);
    }

    if (result.expertScores) {
      console.log('\n📊 专家评分:');
      console.log('  Flex:', result.expertScores.flex?.dimension_score);
      console.log('  Vibe:', result.expertScores.vibe?.strength);
      console.log('  Gossip:', result.expertScores.gossip?.confidence);
    }

    if (result.debug) {
      console.log('\n🔍 调试信息:');
      console.log('  步骤数:', result.debug.agentSteps.length);
      console.log('  Token 数:', result.debug.totalTokens);
      console.log('  耗时:', (result.debug.totalLatencyMs / 1000).toFixed(2), 's');
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }
}

/**
 * 示例：多照片聚类测试
 */
async function testMultiPhotoClustering() {
  console.log('\n=== 多照片聚类测试 ===\n');

  const orchestrator = new PaparazziOrchestrator();

  // 模拟多张照片
  const photos: PhotoInput[] = [
    createTestPhoto('/9j/4AAQSkZJRgABAQAA...1'),
    createTestPhoto('/9j/4AAQSkZJRgABAQAA...2'),
    createTestPhoto('/9j/4AAQSkZJRgABAQAA...3'),
  ];

  const input: AgentInput = {
    userId: 'test_user_002',
    photos,
    preferredStyle: 'humorous'
  };

  try {
    const result = await orchestrator.run(input);

    console.log('状态:', result.status);
    if (result.story) {
      console.log('聚类后故事:', result.story.title);
    }

  } catch (error: any) {
    console.error('❌ 多照片测试失败:', error.message);
  }
}

/**
 * 示例：使用真实照片文件测试
 */
async function testWithRealPhoto(imagePath: string) {
  console.log('\n=== 真实照片测试 ===\n');

  const fs = require('fs');
  const base64 = fs.readFileSync(imagePath, 'base64');

  const orchestrator = new PaparazziOrchestrator();

  const input: AgentInput = {
    userId: 'test_user_003',
    photos: [{
      base64,
      mimeType: 'image/jpeg',
      localIdentifier: 'real_photo_test'
    }]
  };

  try {
    const result = await orchestrator.run(input, (step) => {
      console.log(`  ${step.message}`);
    });

    console.log('\n结果:', result.status);

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }
}

// ==================== 主入口 ====================

async function main() {
  console.log('========================================');
  console.log('  Pixel Beat Agent SDK - V3 SDK 测试');
  console.log('========================================');

  // 检查环境变量
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 缺少 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  缺少 GEMINI_API_KEY，部分功能可能不可用');
  }

  // 运行测试
  await testWithPlaceholderImage();
  // await testMultiPhotoClustering();
  // await testWithRealPhoto('/path/to/your/photo.jpg');

  console.log('\n✅ 测试完成\n');
}

// 运行
main().catch(console.error);
