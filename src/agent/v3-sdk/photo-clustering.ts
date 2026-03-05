/**
 * 照片聚类与故事候选筛选
 *
 * 功能：
 * 1. 基于 VLM 分析结果 + EXIF 信息聚类照片
 * 2. 识别可讲故事的主题
 * 3. 为每个故事选择主图
 */

export interface PhotoMeta {
  index: number;
  timestamp?: number;  // EXIF 时间戳
  location?: string;   // EXIF 地点
  analysis: {
    scene?: string;
    entities?: string[];
    emotion?: string;
    activities?: string[];
  };
}

export interface StoryCandidate {
  id: string;
  theme: string;           // 故事主题
  heroPhoto: number;       // 主图索引
  supportPhotos: number[]; // 辅助照片索引
  storyPotential: number;  // 故事潜力评分 (0-10)
  angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast';
  reason: string;          // 为什么值得讲
}

export interface ClusteringResult {
  totalPhotos: number;
  storyCandidates: StoryCandidate[];
  skippedPhotos: number[];  // 不适合讲故事的照片
  reasoning: string;
}

/**
 * 照片聚类器
 */
export class PhotoClusterer {

  /**
   * 基于 VLM 分析结果和 EXIF 信息聚类照片
   */
  clusterPhotos(photos: PhotoMeta[]): ClusteringResult {
    console.log(`[Clusterer] Processing ${photos.length} photos`);

    const candidates: StoryCandidate[] = [];
    const skipped: number[] = [];
    const used = new Set<number>();

    // 1. 按时间分组（1小时内的照片归为一组）
    const timeGroups = this.groupByTime(photos, 3600000); // 1小时

    // 2. 对每个时间组进行主题聚类
    for (const group of timeGroups) {
      if (group.length === 0) continue;

      // 按场景/活动细分
      const themeGroups = this.groupByTheme(group);

      for (const themeGroup of themeGroups) {
        const candidate = this.evaluateStoryCandidate(themeGroup);

        if (candidate && candidate.storyPotential >= 5) {
          candidates.push(candidate);
          themeGroup.forEach(p => used.add(p.index));
        }
      }
    }

    // 3. 标记跳过的照片
    for (const photo of photos) {
      if (!used.has(photo.index)) {
        skipped.push(photo.index);
      }
    }

    // 4. 按故事潜力排序
    candidates.sort((a, b) => b.storyPotential - a.storyPotential);

    return {
      totalPhotos: photos.length,
      storyCandidates: candidates,
      skippedPhotos: skipped,
      reasoning: this.generateReasoning(candidates, skipped)
    };
  }

  /**
   * 按时间分组
   */
  private groupByTime(photos: PhotoMeta[], intervalMs: number): PhotoMeta[][] {
    if (photos.length === 0) return [];

    // 按时间排序
    const sorted = [...photos].sort((a, b) =>
      (a.timestamp || 0) - (b.timestamp || 0)
    );

    const groups: PhotoMeta[][] = [];
    let currentGroup: PhotoMeta[] = [sorted[0]];
    let groupStartTime = sorted[0].timestamp || 0;

    for (let i = 1; i < sorted.length; i++) {
      const photo = sorted[i];
      const photoTime = photo.timestamp || 0;

      if (photoTime - groupStartTime <= intervalMs) {
        currentGroup.push(photo);
      } else {
        groups.push(currentGroup);
        currentGroup = [photo];
        groupStartTime = photoTime;
      }
    }

    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * 按主题分组
   */
  private groupByTheme(photos: PhotoMeta[]): PhotoMeta[][] {
    if (photos.length <= 2) return [photos];

    const groups: PhotoMeta[][] = [];
    const used = new Set<number>();

    // 尝试按场景分组
    const sceneMap = new Map<string, PhotoMeta[]>();

    for (const photo of photos) {
      const scene = photo.analysis.scene || 'unknown';
      if (!sceneMap.has(scene)) {
        sceneMap.set(scene, []);
      }
      sceneMap.get(scene)!.push(photo);
    }

    // 每个场景作为一组
    for (const [scene, scenePhotos] of sceneMap) {
      if (scenePhotos.length >= 1) {
        groups.push(scenePhotos);
        scenePhotos.forEach(p => used.add(p.index));
      }
    }

    // 未分组的照片
    const ungrouped = photos.filter(p => !used.has(p.index));
    if (ungrouped.length > 0) {
      groups.push(ungrouped);
    }

    return groups;
  }

  /**
   * 评估故事候选
   */
  private evaluateStoryCandidate(photos: PhotoMeta[]): StoryCandidate | null {
    if (photos.length === 0) return null;

    // 选择主图（信息最丰富的）
    let heroIndex = 0;
    let maxScore = 0;

    for (let i = 0; i < photos.length; i++) {
      const score = this.scorePhotoRichness(photos[i]);
      if (score > maxScore) {
        maxScore = score;
        heroIndex = i;
      }
    }

    const hero = photos[heroIndex];
    const supports = photos
      .filter((_, i) => i !== heroIndex)
      .map(p => p.index);

    // 评估故事潜力
    const { potential, angle, reason } = this.assessStoryPotential(hero, photos);

    // 生成主题
    const theme = this.generateTheme(hero, photos);

    return {
      id: `candidate_${Date.now()}_${heroIndex}`,
      theme,
      heroPhoto: hero.index,
      supportPhotos: supports,
      storyPotential: potential,
      angle,
      reason
    };
  }

  /**
   * 评估照片信息丰富度
   */
  private scorePhotoRichness(photo: PhotoMeta): number {
    let score = 0;

    // 有场景描述
    if (photo.analysis.scene) score += 2;

    // 有实体
    if (photo.analysis.entities && photo.analysis.entities.length > 0) {
      score += Math.min(photo.analysis.entities.length, 3);
    }

    // 有情绪
    if (photo.analysis.emotion) score += 2;

    // 有活动
    if (photo.analysis.activities && photo.analysis.activities.length > 0) {
      score += 2;
    }

    // 有地点信息
    if (photo.location) score += 1;

    return score;
  }

  /**
   * 评估故事潜力
   */
  private assessStoryPotential(
    hero: PhotoMeta,
    allPhotos: PhotoMeta[]
  ): {
    potential: number;
    angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast';
    reason: string;
  } {
    let potential = 5; // 基础分
    let angle: 'hidden_flex' | 'emotion_peak' | 'share_value' | 'time_contrast' = 'share_value';
    let reason = '';

    const scene = hero.analysis.scene?.toLowerCase() || '';
    const emotion = hero.analysis.emotion?.toLowerCase() || '';
    const entities = hero.analysis.entities || [];
    const activities = hero.analysis.activities || [];

    // 隐形炫耀判断
    const flexKeywords = ['餐厅', '酒店', '旅行', '品牌', '奢华', '米其林', '头等舱', '豪华'];
    if (flexKeywords.some(k => scene.includes(k) || entities.some(e => e.includes(k)))) {
      potential += 2;
      angle = 'hidden_flex';
      reason = '发现隐形炫耀点';
    }

    // 情绪高点判断
    const emotionKeywords = ['开心', '兴奋', '感动', '惊喜', '幸福'];
    if (emotionKeywords.some(k => emotion.includes(k))) {
      potential += 2;
      angle = 'emotion_peak';
      reason = '捕捉到情绪高点';
    }

    // 社交价值判断
    const socialKeywords = ['朋友', '聚会', '庆祝', '生日', '婚礼'];
    if (socialKeywords.some(k =>
      scene.includes(k) || activities.some(a => a.includes(k))
    )) {
      potential += 1;
      angle = 'share_value';
      reason = '社交分享价值高';
    }

    // 多张照片加分
    if (allPhotos.length >= 3) {
      potential += 1;
      reason += '，多角度记录';
    }

    // 有地点信息加分
    if (hero.location) {
      potential += 0.5;
    }

    // 限制最高分
    potential = Math.min(potential, 10);

    return { potential, angle, reason: reason || '日常记录' };
  }

  /**
   * 生成故事主题
   */
  private generateTheme(hero: PhotoMeta, allPhotos: PhotoMeta[]): string {
    const scene = hero.analysis.scene || '';
    const activities = hero.analysis.activities?.join('、') || '';
    const location = hero.location || '';

    if (location && activities) {
      return `在${location}${activities}`;
    } else if (scene) {
      return scene;
    } else if (activities) {
      return activities;
    }

    return '今日记录';
  }

  /**
   * 生成推理说明
   */
  private generateReasoning(
    candidates: StoryCandidate[],
    skipped: number[]
  ): string {
    const parts: string[] = [];

    parts.push(`发现 ${candidates.length} 个可讲的故事`);

    if (candidates.length > 0) {
      const best = candidates[0];
      parts.push(`推荐: "${best.theme}" (潜力 ${best.storyPotential.toFixed(1)})`);
    }

    if (skipped.length > 0) {
      parts.push(`跳过 ${skipped.length} 张不适合单独成故事的照片`);
    }

    return parts.join('；');
  }
}

// 导出单例
export const photoClusterer = new PhotoClusterer();
