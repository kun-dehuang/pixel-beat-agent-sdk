/**
 * Mock 服务层 - 用于本地测试，不依赖外部 API
 *
 * 使用方式：在测试中替换真实服务
 */

import type {
  PaparazziImageAnalysis,
  PaparazziMemoryContext,
  PaparazziUserProfile,
  Story
} from '../agent/v3-sdk/types';

/**
 * Mock VLM 分析结果
 */
export function mockImageAnalysis(): PaparazziImageAnalysis {
  return {
    summary: '一位年轻女性在咖啡厅专注工作，桌上放着一杯拿铁和笔记本电脑',
    mood: '专注、平静、略带疲惫',
    vibes: ['都市生活', '工作日常', '独处时光', '咖啡文化'],
    weather: {
      condition: null,
      rarity: 'normal',
      visual_elements: []
    },
    macro_event: {
      event_type: '工作',
      activity: '办公/远程工作',
      social_context: '独自'
    },
    brands: ['Apple', 'Starbucks'],
    violations: [],
    people: {
      count: 1,
      genders: ['女性'],
      age_group: '青年',
      composition: '他拍',
      pose: '坐姿',
      gaze: '看向屏幕',
      facial_expression: '专注',
      demeanor: '放松',
      emotions: ['专注', '平静'],
      actions: ['打字', '看屏幕'],
      body_display: {
        has_muscle: false,
        has_skin_showcase: false,
        fitness_level: '未知',
        body_type: '中等',
        posture: '正常坐姿'
      }
    },
    scene: {
      location_detected: '咖啡厅',
      location_type: '室内',
      visual_clues: ['咖啡杯', '笔记本电脑', '窗户', '绿植'],
      environment_details: ['温馨灯光', '木质桌椅', '墙面装饰']
    },
    clothing: {
      description: '简约休闲风格，穿着舒适的针织衫',
      items: ['针织衫', '眼镜'],
      style: '简约'
    },
    story_hints: [
      '996打工人的下午茶时光',
      '从外卖到精品咖啡的升级',
      '项目deadline前的宁静'
    ]
  };
}

/**
 * Mock 记忆检索结果
 */
export function mockMemoryContext(): PaparazziMemoryContext {
  return {
    top_angles: [
      {
        angle_type: 'emotion_echo',
        angle_name: '情绪回响: 专注时刻',
        confidence: 0.85,
        description: '用户常在咖啡厅工作，这是她的日常状态',
        matched_items: ['咖啡厅', '工作', '笔记本']
      },
      {
        angle_type: 'time_contrast',
        angle_name: '时间对比: 职场进阶',
        confidence: 0.72,
        description: '从便利店速溶到精品咖啡，工作方式的变化',
        memory_date: '2024-01-15'
      }
    ],
    total_matches: 2,
    active_paths: ['emotion', 'entity']
  };
}

/**
 * Mock 用户画像
 */
export function mockUserProfile(): PaparazziUserProfile {
  return {
    age: 26,
    gender: '女',
    interests: ['咖啡', '旅行', '摄影', '瑜伽'],
    typical_brands: ['Apple', 'Lululemon', 'Starbucks'],
    personality: ['内向', '完美主义', '文艺'],
    consumption_level: '中高',
    memory_context: mockMemoryContext()
  };
}

/**
 * Mock 生成的故事
 */
export function mockStory(): Story {
  return {
    id: `story_${Date.now()}`,
    title: '从996到下午茶',
    body: '两周前她还在工位上吃外卖，今天却在咖啡厅享受下午茶。这不是偷懒，是项目顺利上线的庆祝杯。咖啡还是那个味道，但心情已经不一样了。',
    angle: 'emotion_peak',
    style: 'natural',
    score: 8.2,
    expertScores: {
      flex: {
        category: '生活方式',
        subcategory: '消费升级',
        dimension_score: 3,
        confidence: 0.75,
        core_narrative: '从便利店的速溶咖啡到精品咖啡店的体验升级'
      },
      vibe: {
        vibe_type: '放松/享受',
        emotional_tone: '满足、平静',
        strength: 0.8,
        confidence: 0.85,
        core_narrative: '工作压力释放后的放松时刻'
      },
      gossip: {
        gossip_type: '反常行为',
        social_dynamics: '工作日不在公司',
        confidence: 0.6,
        core_narrative: '工作日下午不在公司的神秘感'
      }
    },
    createdAt: Date.now()
  };
}

/**
 * Mock 互动预测
 */
export function mockEngagementPrediction() {
  return {
    likes: 32,
    comments: 16,
    shares: 5,
    likelyReactions: ['太懂了', '你也辛苦了', '下次一起去', '在哪里'],
    viralBreakdown: {
      gossip: 7.5,
      hotness: 8.0,
      status: 8.5,
      class: 7.0,
      memoryDepth: 9.0
    }
  };
}

/**
 * Mock AI Service
 */
export class MockAIService {
  async analyze() {
    return mockImageAnalysis();
  }

  async generateStory() {
    return mockStory();
  }

  async predictEngagement() {
    return mockEngagementPrediction();
  }
}

/**
 * Mock Memory Service
 */
export class MockMemoryService {
  async retrieve() {
    return {
      angles: mockMemoryContext().top_angles,
      memories: [
        {
          id: 'mem_001',
          content: '去年冬天在星巴克加班到深夜...',
          emotion: '疲惫',
          date: '2024-01-15'
        }
      ]
    };
  }
}

/**
 * Mock 工具处理器
 */
export class MockToolHandlers {
  constructor(
    private aiService: MockAIService = new MockAIService(),
    private memoryService: MockMemoryService = new MockMemoryService()
  ) {}

  async analyzePhotos() {
    return { analysis: mockImageAnalysis() };
  }

  async retrieveMemories() {
    return {
      angles: mockMemoryContext().top_angles,
      memories: []
    };
  }

  async generateStory() {
    return { story: mockStory() };
  }

  async predictEngagement() {
    return mockEngagementPrediction();
  }
}
