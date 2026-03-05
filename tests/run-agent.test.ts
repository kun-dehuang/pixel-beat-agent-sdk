/**
 * V3 双层架构 Agent 测试
 *
 * 运行: npm run test
 */

import * as dotenv from 'dotenv';
import { PixelBeatAgentV3 } from '../src/agent/v3';
import type { AgentV3Input } from '../src/agent/v3/types';

// 加载环境变量
dotenv.config();

/**
 * 测试双层架构 Agent
 */
async function testDualLayerAgent() {
  console.log('\n=== V3 双层架构 Agent 测试 ===\n');

  const agent = new PixelBeatAgentV3();

  // 占位图片 - 实际使用时替换为真实 base64
  const input: AgentV3Input = {
    userId: 'test_user_001',
    photos: [{
      base64: '/9j/4AAQSkZJRgABAQAA...', // 替换为真实图片
      mimeType: 'image/jpeg'
    }],
    preferredStyle: 'natural',
    generateStory: true
  };

  console.log('📸 输入照片数量:', input.photos.length);
  console.log('👤 用户 ID:', input.userId);
  console.log('🎨 偏好风格:', input.preferredStyle);

  try {
    const result = await agent.run(input);

    console.log('\n=== 结果 ===');
    console.log('状态:', result.status);

    if (result.story) {
      console.log('\n📖 生成的故事:');
      console.log('  标题:', result.story.title);
      console.log('  正文:', result.story.body);
      console.log('  角度:', result.story.angle);
      console.log('  评分:', result.story.score);
    }

    if (result.debug) {
      console.log('\n🔍 调试信息:');
      console.log('  对话轮次:', result.debug.dialogueTurns);
      console.log('  执行轮次:', result.debug.executionTurns);
      console.log('  总 Token:', result.debug.totalTokens);
      console.log('  耗时:', (result.debug.totalLatencyMs / 1000).toFixed(2), 's');
      console.log('  对话步骤:', result.debug.dialogueSteps.join(' → '));
    }

    // 测试确认流程
    if (result.status === 'pending_confirmation' && result.story) {
      console.log('\n=== 测试确认流程 ===');

      const confirmResult = await agent.handleConfirmation(
        result.story.id,
        true,
        '很好，就这样发布'
      );

      console.log('确认结果:', confirmResult);
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    console.error(error.stack);
  }
}

/**
 * 测试多角度故事生成
 */
async function testMultiAngleGeneration() {
  console.log('\n=== 多角度故事生成测试 ===\n');

  const agent = new PixelBeatAgentV3();

  const input: AgentV3Input = {
    userId: 'test_user_002',
    photos: [{
      base64: '/9j/4AAQSkZJRgABAQAA...',
      mimeType: 'image/jpeg'
    }],
    preferredStyle: 'natural'
  };

  try {
    const result = await agent.run(input);

    if (result.alternatives && result.alternatives.length > 0) {
      console.log(`\n生成 ${result.alternatives.length + 1} 个候选故事:\n`);

      console.log('1. 主故事:', result.story?.title);
      result.alternatives.forEach((alt, idx) => {
        console.log(`  ${idx + 2}. ${alt.title} (${alt.angle})`);
      });
    }

  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
  }
}

// ==================== 主入口 ====================

async function main() {
  console.log('========================================');
  console.log('  Pixel Beat Agent SDK - V3 双层架构测试');
  console.log('========================================');

  // 检查环境变量
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ 缺少 ANTHROPIC_API_KEY 环境变量');
    process.exit(1);
  }

  // 运行测试
  await testDualLayerAgent();
  // await testMultiAngleGeneration();

  console.log('\n✅ 测试完成\n');
}

// 运行
main().catch(console.error);
