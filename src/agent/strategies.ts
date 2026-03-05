/**
 * 叙事策略模板 - ReAct Agent 决策框架
 *
 * 四种核心策略，每种针对不同的照片特征和叙事目标
 */

export type StrategyType = "time_contrast" | "subtle_flex" | "emotion_capture" | "value_share";

export interface StrategyTemplate {
  id: StrategyType;
  name: string;
  description: string;
  structure: string;
  triggerConditions: string[];
  viralAdvantages: {
    primary: string;
    secondary: string;
  };
  qualityChecklist: string[];
  examples: {
    good: string;
    bad: string;
    explanation: string;
  };
  keyElements: string[];
  wordCountRange: {
    min: number;
    max: number;
  };
}

/**
 * 四种叙事策略模板
 */
export const STRATEGY_TEMPLATES: Record<StrategyType, StrategyTemplate> = {
  /**
   * A. 时间对比型 - 适合有历史记忆关联的场景
   */
  time_contrast: {
    id: "time_contrast",
    name: "时间对比",
    description: "通过今昔对比，展现成长、变化或回忆，增加故事的时间厚度",
    structure: "X个月前/年前... → 现在/如今... → 感悟/转变",
    triggerConditions: [
      "memory_confidence >= 0.75",
      "存在情感反差",
      "时间间隔 >= 30天"
    ],
    viralAdvantages: {
      primary: "memory (记忆厚度) ↑↑",
      secondary: "gossip (瓜度) ↑"
    },
    qualityChecklist: [
      "有明确的时间锚点（X个月前、去年、那时候）",
      "今昔形成对比或呼应",
      "情感有变化或升华",
      "结尾有感悟但不说教"
    ],
    examples: {
      good: "半年前，她还在为租房发愁，签约那天握着钥匙的手都在抖。现在站在新装修好的家里，才发现当时那些焦虑，都成了回忆里最甜的部分。",
      bad: "她以前很穷，现在有钱了，买了新房子，很开心。",
      explanation: "好例子有具体细节（握着钥匙的手在抖），有情感转变（焦虑→甜），结尾留白。坏例子过于直白，无细节，无情感层次。"
    },
    keyElements: ["时间锚点", "对比细节", "情感变化", "感悟升华"],
    wordCountRange: { min: 80, max: 150 }
  },

  /**
   * B. 隐形炫耀型 - 适合展示品味、成就、生活方式
   */
  subtle_flex: {
    id: "subtle_flex",
    name: "隐形炫耀",
    description: "不直接炫耀，通过细节侧面展示成就、品味或生活方式",
    structure: "日常场景 → 不经意提及 → 轻描淡写",
    triggerConditions: [
      "照片含品牌物品",
      "展示成就/里程碑",
      "稀缺体验（旅行、活动）"
    ],
    viralAdvantages: {
      primary: "status (局气) ↑↑",
      secondary: "class (B格) ↑"
    },
    qualityChecklist: [
      "不直接点破（不说'我买了XX'）",
      "用日常口吻（'又'、'老是'）",
      "有自嘲或调侃元素",
      "让读者自己发现亮点"
    ],
    examples: {
      good: "她又把那个限量版包忘在咖啡厅了，第三次了。老板娘已经认识她了，每次都帮她收好，还会多送一块蛋糕。",
      bad: "她买了一个限量版的包包，很贵，品牌是XX，全球只有100个。",
      explanation: "好例子用'又忘了'自嘲，'老板娘认识她了'侧面展示是熟客。坏例子直接炫耀，令人反感。"
    },
    keyElements: ["轻描淡写", "侧面暗示", "自嘲语气", "日常化叙述"],
    wordCountRange: { min: 60, max: 120 }
  },

  /**
   * C. 情绪捕捉型 - 适合有明确情绪表达的场景
   */
  emotion_capture: {
    id: "emotion_capture",
    name: "情绪捕捉",
    description: "通过细节描写暗示情绪，不直接说破，让读者自己感受",
    structure: "场景细节 → 动作/神态 → 情绪暗示 → 留白",
    triggerConditions: [
      "照片有明确情绪（喜/悲/惊/怒）",
      "情绪强度 >= 7/10",
      "有故事性的瞬间"
    ],
    viralAdvantages: {
      primary: "hotness (辣度) ↑↑",
      secondary: "gossip (瓜度) ↑"
    },
    qualityChecklist: [
      "有具体的感官细节（看到/听到/闻到）",
      "情绪通过动作或神态暗示，而非直说",
      "结尾留白，不解释",
      "避免使用'开心'、'难过'等直接情绪词"
    ],
    examples: {
      good: "她盯着那杯已经凉透的拿铁，冰块早就化完了。服务员走过来问要不要换一杯，她摇摇头，说'这杯刚刚好'。",
      bad: "她等了很久，很难过，咖啡都凉了。",
      explanation: "好例子用'冰块化完'暗示等待很久，'这杯刚刚好'留白引发联想。坏例子直接说'难过'，无画面感。"
    },
    keyElements: ["感官细节", "动作神态", "情绪暗示", "留白结尾"],
    wordCountRange: { min: 80, max: 140 }
  },

  /**
   * D. 信息分享型 - 适合探店、攻略、推荐类内容
   */
  value_share: {
    id: "value_share",
    name: "信息分享",
    description: "分享有价值的发现或体验，提供实用信息同时保持个人色彩",
    structure: "发现过程 → 真实体验 → 主观评价",
    triggerConditions: [
      "探店/新发现",
      "有实用信息价值",
      "可复制的体验"
    ],
    viralAdvantages: {
      primary: "class (B格) ↑",
      secondary: "status (局气) ↑"
    },
    qualityChecklist: [
      "有发现的过程（'巷子深处'、'朋友推荐'）",
      "有真实的感受（'愣住'、'惊了'）",
      "有可信的细节（具体菜品、价格区间）",
      "有推荐意愿但不过度"
    ],
    examples: {
      good: "巷子深处的那家小店，招牌都快掉了。她本来没抱希望，结果一口下去直接愣住——这是吃过最好吃的牛肉面，没有之一。",
      bad: "这家店超好吃！强烈推荐！必须去！五星好评！",
      explanation: "好例子有发现过程（巷子深处），有反差（招牌快掉→最好吃），有真实反应（愣住）。坏例子全是空洞赞美。"
    },
    keyElements: ["发现过程", "真实反应", "具体细节", "适度推荐"],
    wordCountRange: { min: 70, max: 130 }
  }
};

/**
 * 根据特征评分选择最佳策略
 */
export function selectBestStrategy(
  photoFeatures: {
    hasBrand?: boolean;
    hasAchievement?: boolean;
    hasRareExperience?: boolean;
    emotionStrength?: number;
    hasUsefulInfo?: boolean;
  },
  memoryMatch?: {
    found?: boolean;
    confidence?: number;
    emotionContrast?: boolean;
    timeGapDays?: number;
  }
): {
  strategy: StrategyType;
  scores: Record<StrategyType, number>;
  reasoning: string;
} {
  const scores: Record<StrategyType, number> = {
    time_contrast: 0,
    subtle_flex: 0,
    emotion_capture: 0,
    value_share: 0
  };

  // 时间对比
  if (memoryMatch?.found && (memoryMatch.confidence || 0) >= 0.75) {
    scores.time_contrast += 4;
    if (memoryMatch.emotionContrast) scores.time_contrast += 3;
    if ((memoryMatch.timeGapDays || 0) >= 30) scores.time_contrast += 2;
  }

  // 隐形炫耀
  if (photoFeatures.hasBrand) scores.subtle_flex += 3;
  if (photoFeatures.hasAchievement) scores.subtle_flex += 4;
  if (photoFeatures.hasRareExperience) scores.subtle_flex += 3;

  // 情绪捕捉
  const emotion = photoFeatures.emotionStrength || 0;
  if (emotion >= 7) scores.emotion_capture += 5;
  else if (emotion >= 5) scores.emotion_capture += 3;

  // 信息分享
  if (photoFeatures.hasUsefulInfo) scores.value_share += 4;

  // 选择最高分
  const maxScore = Math.max(...Object.values(scores));
  const strategy = (Object.entries(scores).find(([, s]) => s === maxScore)?.[0] || "value_share") as StrategyType;

  // 生成推理
  let reasoning = "";
  switch (strategy) {
    case "time_contrast":
      reasoning = `高置信度记忆匹配(${((memoryMatch?.confidence || 0) * 100).toFixed(0)}%)，适合时间对比叙事`;
      break;
    case "subtle_flex":
      reasoning = "照片包含品牌/成就/稀缺体验，适合隐形炫耀叙事";
      break;
    case "emotion_capture":
      reasoning = `情绪强度${emotion}/10，适合情绪捕捉叙事`;
      break;
    case "value_share":
      reasoning = "照片包含实用信息，适合信息分享叙事";
      break;
  }

  return { strategy, scores, reasoning };
}

/**
 * 获取策略模板
 */
export function getStrategyTemplate(strategy: StrategyType): StrategyTemplate {
  return STRATEGY_TEMPLATES[strategy];
}

/**
 * 质量检查
 */
export function checkStoryQuality(
  story: string,
  strategy: StrategyType
): {
  passed: boolean;
  checklist: Array<{ item: string; passed: boolean }>;
  suggestions: string[];
} {
  const template = STRATEGY_TEMPLATES[strategy];
  const checklist: Array<{ item: string; passed: boolean }> = [];
  const suggestions: string[] = [];

  // 通用检查
  const isThirdPerson = story.includes("她") || story.includes("他");
  checklist.push({ item: "第三人称", passed: isThirdPerson });
  if (!isThirdPerson) suggestions.push("使用'她/他'替代'我'");

  const wordCount = story.length;
  const wordCountOk = wordCount >= template.wordCountRange.min && wordCount <= template.wordCountRange.max;
  checklist.push({ item: `字数${template.wordCountRange.min}-${template.wordCountRange.max}`, passed: wordCountOk });
  if (!wordCountOk) suggestions.push(`调整字数到${template.wordCountRange.min}-${template.wordCountRange.max}之间`);

  const hasTension = ["却", "没想到", "竟然", "原来", "才发现"].some(w => story.includes(w));
  checklist.push({ item: "叙事张力", passed: hasTension });
  if (!hasTension) suggestions.push("添加转折词增加张力");

  const noDirectEmotion = !["很开心", "很难过", "很高兴", "非常喜欢"].some(w => story.includes(w));
  checklist.push({ item: "避免直白情绪词", passed: noDirectEmotion });
  if (!noDirectEmotion) suggestions.push("用动作或细节暗示情绪，而非直说");

  const passed = checklist.every(c => c.passed);

  return { passed, checklist, suggestions };
}
