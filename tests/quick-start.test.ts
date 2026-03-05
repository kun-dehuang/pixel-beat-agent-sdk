/**
 * 快速开始测试 - 使用 Mock 服务，无需 API Keys
 *
 * 运行: npx ts-node tests/quick-start.test.ts
 */

import {
  mockImageAnalysis,
  mockMemoryContext,
  mockStory,
  mockEngagementPrediction,
  MockToolHandlers
} from '../src/mocks/mock-services';

console.log('========================================');
console.log('  Pixel Beat Agent SDK - 快速开始');
console.log('  (使用 Mock 服务，无需 API Keys)');
console.log('========================================\n');

// 1. Mock VLM 图像分析
console.log('### 1. VLM 图像分析 (Mock)\n');
const imageAnalysis = mockImageAnalysis();
console.log('摘要:', imageAnalysis.summary);
console.log('情绪:', imageAnalysis.mood);
console.log('氛围关键词:', imageAnalysis.vibes.join(', '));
console.log('事件类型:', imageAnalysis.macro_event.event_type);

// 2. Mock 记忆检索
console.log('\n### 2. 记忆检索 (Mock)\n');
const memoryContext = mockMemoryContext();
console.log('检索到', memoryContext.total_matches, '个相关角度:');
memoryContext.top_angles.forEach((angle, idx) => {
  console.log(`  ${idx + 1}. ${angle.angle_name} (置信度: ${angle.confidence})`);
});

// 3. Mock 故事生成
console.log('\n### 3. 故事生成 (Mock)\n');
const story = mockStory();
console.log('标题:', story.title);
console.log('正文:', story.body);
console.log('角度:', story.angle);
console.log('评分:', story.score);

if (story.expertScores) {
  console.log('\n专家评分:');
  console.log('  Flex:', story.expertScores.flex?.dimension_score);
  console.log('  Vibe:', story.expertScores.vibe?.strength);
  console.log('  Gossip:', story.expertScores.gossip?.confidence);
}

// 4. Mock 互动预测
console.log('\n### 4. 互动预测 (Mock)\n');
const engagement = mockEngagementPrediction();
console.log('预计点赞:', engagement.likes);
console.log('预计评论:', engagement.comments);
console.log('可能反应:', engagement.likelyReactions.join(', '));

// 5. 使用 Mock 工具处理器
console.log('\n### 5. Mock 工具处理器\n');
const toolHandlers = new MockToolHandlers();

(async () => {
  const analysisResult = await toolHandlers.analyzePhotos();
  console.log('分析结果:', analysisResult.analysis.summary);

  const memoryResult = await toolHandlers.retrieveMemories();
  console.log('记忆检索:', memoryResult.angles.length, '个角度');

  const storyResult = await toolHandlers.generateStory();
  console.log('生成故事:', storyResult.story.title);

  const engagementResult = await toolHandlers.predictEngagement();
  console.log('互动预测:', engagementResult.likes, '赞');

  console.log('\n✅ Mock 测试完成!');
  console.log('\n下一步:');
  console.log('  1. 配置 .env 文件，添加真实的 API Keys');
  console.log('  2. 运行 npm run test 进行真实测试');
  console.log('  3. 查看 examples/ 目录了解更多用法\n');
})();
