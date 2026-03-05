/**
 * Memory Trace Agent - Prompt Configuration Manager
 *
 * 支持运行时 prompt 配置管理:
 * - 从 JSON 文件加载 prompts
 * - 运行时热更新
 * - 版本管理和回滚
 * - 导入导出
 */

import { MongoClient, Db, Collection } from 'mongodb';
import Anthropic from "@anthropic-ai/sdk";
import {
  MEMORY_TRACE_SYSTEM_PROMPT,
  MEMORY_TRACE_TOOLS,
  MemoryTraceToolConfig
} from './memory-trace-prompt';

// ==================== 类型定义 ====================

export interface MemoryTracePromptConfig {
  id: string;
  name: string;
  version: number;
  description?: string;
  systemPrompt: string;
  userMessageTemplate: string;
  tools: MemoryTraceToolConfig[];
  modelConfig?: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
  };
  createdAt?: number;
  updatedAt?: number;
}

export interface MemoryTracePromptVersion {
  version: number;
  timestamp: number;
  content: MemoryTracePromptConfig;
  changeLog?: string;
}

// ==================== 默认用户消息模板 ====================

const DEFAULT_USER_MESSAGE_TEMPLATE = `请分析这 {{photoCount}} 张照片，找出有故事价值的元素并生成溯源叙事。

请依次：
1. 获取用户人设画像
2. 识别照片中有故事价值的物体/场景
3. 搜索相关记忆进行跨时间匹配
4. 为有价值的锚点生成溯源叙事

每张照片最多 3 个锚点，没有故事价值的照片返回空数组。`;

// ==================== MemoryTracePromptConfigManager ====================

export class MemoryTracePromptConfigManager {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private configCollection: Collection | null = null;
  private versionCollection: Collection | null = null;
  private isConnected = false;
  private isLoaded = false;
  private connectPromise: Promise<void> | null = null;

  private currentConfig: MemoryTracePromptConfig;
  private versionHistory: MemoryTracePromptVersion[] = [];

  constructor() {
    this.currentConfig = this.getDefaultConfig();

    // 异步连接 MongoDB 并加载配置（fire and forget）
    this.connectAndLoad();

    console.log(`✅ MemoryTracePromptConfigManager initialized with defaults (v${this.currentConfig.version})`);
  }

  // ==================== MongoDB 连接 ====================

  private async ensureConnected(): Promise<void> {
    if (this.isConnected && this.isLoaded) return;
    if (!this.connectPromise) {
      this.connectPromise = this.doConnectAndLoad();
    }
    await this.connectPromise;
  }

  private connectAndLoad(): void {
    this.connectPromise = this.doConnectAndLoad();
    this.connectPromise.catch(err => {
      console.error('[MemoryTracePromptConfig] Background connect failed:', err);
    });
  }

  private async doConnectAndLoad(): Promise<void> {
    if (this.isLoaded) return;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('⚠️ MONGODB_URI not set, MemoryTracePromptConfigManager will use defaults only');
      this.isLoaded = true;
      return;
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      this.db = this.client.db('pixelbeat');
      this.configCollection = this.db.collection('memory_trace_prompt_configs');
      this.versionCollection = this.db.collection('memory_trace_prompt_versions');

      await this.versionCollection.createIndex({ configId: 1, version: -1 });

      this.isConnected = true;
      await this.loadFromDB();
      this.isLoaded = true;
      console.log('✅ MemoryTracePromptConfigManager MongoDB connected and loaded');
    } catch (error) {
      console.error('❌ MemoryTracePromptConfigManager MongoDB connection failed:', error);
      this.isLoaded = true;
    }
  }

  // ==================== 获取配置 ====================

  getConfig(): MemoryTracePromptConfig {
    return this.currentConfig;
  }

  getSystemPrompt(): string {
    return this.currentConfig.systemPrompt;
  }

  getTools(): Anthropic.Tool[] {
    return this.currentConfig.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
  }

  getToolProgressMessages(): Record<string, string> {
    const messages: Record<string, string> = {};
    for (const tool of this.currentConfig.tools) {
      if (tool.progressMessage) {
        messages[tool.name] = tool.progressMessage;
      }
    }
    return messages;
  }

  getUserMessageTemplate(): string {
    return this.currentConfig.userMessageTemplate;
  }

  // ==================== 模板渲染 ====================

  renderUserMessage(params: { photoCount: number; hasPersona: boolean }): string {
    let template = this.getUserMessageTemplate();
    template = template.replace(/\{\{photoCount\}\}/g, String(params.photoCount));
    return template.trim();
  }

  // ==================== 配置更新 ====================

  async updateConfig(updates: Partial<MemoryTracePromptConfig>): Promise<boolean> {
    try {
      await this.ensureConnected();

      // 保存旧版本
      const version: MemoryTracePromptVersion = {
        version: this.currentConfig.version,
        timestamp: Date.now(),
        content: { ...this.currentConfig }
      };
      this.versionHistory.push(version);
      if (this.versionHistory.length > 50) {
        this.versionHistory.shift();
      }

      this.currentConfig = {
        ...this.currentConfig,
        ...updates,
        version: this.currentConfig.version + 1,
        updatedAt: Date.now()
      };

      // 持久化到 MongoDB
      await this.saveToDB();
      await this.saveVersionToDB(version);

      console.log(`✅ MemoryTrace config updated to v${this.currentConfig.version}`);
      return true;
    } catch (error) {
      console.error('[MemoryTracePromptConfig] Update failed:', error);
      return false;
    }
  }

  async updateSystemPrompt(systemPrompt: string): Promise<boolean> {
    return this.updateConfig({ systemPrompt });
  }

  async updateTools(tools: MemoryTraceToolConfig[]): Promise<boolean> {
    return this.updateConfig({ tools });
  }

  async rollbackToVersion(version: number): Promise<boolean> {
    await this.ensureConnected();

    const target = this.versionHistory.find(v => v.version === version);
    if (!target) {
      console.error(`[MemoryTracePromptConfig] Version ${version} not found`);
      return false;
    }
    this.currentConfig = { ...target.content };
    await this.saveToDB();
    console.log(`✅ MemoryTrace rolled back to v${version}`);
    return true;
  }

  getVersionHistory(): MemoryTracePromptVersion[] {
    return this.versionHistory;
  }

  resetToDefault(): void {
    // 保存当前版本
    const version: MemoryTracePromptVersion = {
      version: this.currentConfig.version,
      timestamp: Date.now(),
      content: { ...this.currentConfig }
    };
    this.versionHistory.push(version);
    if (this.versionHistory.length > 50) {
      this.versionHistory.shift();
    }

    this.currentConfig = this.getDefaultConfig();
    this.currentConfig.version = (this.versionHistory[this.versionHistory.length - 1]?.version || 0) + 1;

    // Fire and forget — 保持同步方法签名兼容 routes
    this.saveToDB().catch(err => console.error('[MemoryTracePromptConfig] Reset saveToDB error:', err));
    this.saveVersionToDB(version).catch(err => console.error('[MemoryTracePromptConfig] Reset saveVersionToDB error:', err));

    console.log('[MemoryTracePromptConfig] Reset to default config');
  }

  // ==================== MongoDB 数据操作 ====================

  private async loadFromDB(): Promise<void> {
    if (!this.configCollection || !this.versionCollection) return;

    try {
      const doc = await this.configCollection.findOne({ id: 'memory-trace-v1' });
      if (doc) {
        const { _id, ...config } = doc;
        if (this.validateConfig(config)) {
          this.currentConfig = config as unknown as MemoryTracePromptConfig;
          console.log(`[MemoryTracePromptConfig] Loaded config v${this.currentConfig.version} from MongoDB`);
        }
      }

      // 加载版本历史（按版本号升序，最多 50 条）
      const versions = await this.versionCollection
        .find({ configId: 'memory-trace-v1' })
        .sort({ version: 1 })
        .limit(50)
        .toArray();

      this.versionHistory = versions.map(({ _id, configId, ...v }) => v as unknown as MemoryTracePromptVersion);
    } catch (error) {
      console.error('[MemoryTracePromptConfig] Failed to load from MongoDB:', error);
    }
  }

  private async saveToDB(): Promise<void> {
    if (!this.isConnected || !this.configCollection) return;

    try {
      await this.configCollection.replaceOne(
        { id: 'memory-trace-v1' },
        this.currentConfig,
        { upsert: true }
      );
    } catch (error) {
      console.error('[MemoryTracePromptConfig] Failed to save to MongoDB:', error);
    }
  }

  private async saveVersionToDB(version: MemoryTracePromptVersion): Promise<void> {
    if (!this.isConnected || !this.versionCollection) return;

    try {
      await this.versionCollection.insertOne({
        configId: 'memory-trace-v1',
        ...version
      });

      // 保留最多 50 个版本
      const count = await this.versionCollection.countDocuments({ configId: 'memory-trace-v1' });
      if (count > 50) {
        const oldest = await this.versionCollection
          .find({ configId: 'memory-trace-v1' })
          .sort({ version: 1 })
          .limit(count - 50)
          .toArray();

        if (oldest.length > 0) {
          await this.versionCollection.deleteMany({
            _id: { $in: oldest.map(d => d._id) }
          });
        }
      }
    } catch (error) {
      console.error('[MemoryTracePromptConfig] Failed to save version to MongoDB:', error);
    }
  }

  private validateConfig(config: unknown): config is MemoryTracePromptConfig {
    if (!config || typeof config !== 'object') return false;
    const c = config as Record<string, unknown>;
    return (
      typeof c.id === 'string' &&
      typeof c.name === 'string' &&
      typeof c.systemPrompt === 'string' &&
      Array.isArray(c.tools)
    );
  }

  private getDefaultConfig(): MemoryTracePromptConfig {
    return {
      id: 'memory-trace-v1',
      name: 'Memory Trace Agent',
      version: 1,
      description: '记忆溯源分析 Agent',
      systemPrompt: MEMORY_TRACE_SYSTEM_PROMPT,
      userMessageTemplate: DEFAULT_USER_MESSAGE_TEMPLATE,
      tools: [...MEMORY_TRACE_TOOLS],
      modelConfig: {
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        temperature: undefined  // uses API default
      },
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }
}

// ==================== 导出单例 ====================

export const memoryTracePromptConfigManager = new MemoryTracePromptConfigManager();
