import axios, { AxiosError } from 'axios';

// 响应类型定义
interface AddMemoryResponse {
  success: boolean;
  memory_id: string;
  message: string;
}

interface SelectWithAnswerResponse {
  query: string;
  answer: string;
  memories: string[];
  relations: Array<{
    source: string;
    relationship: string;
    destination: string;
  }>;
  raw_results: any[];
}

/**
 * Memory Select 服务客户端
 * 对接远程 memory-select 服务的记忆存储和查询功能
 */
export class MemorySelectService {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    // Railway 生产环境 URL
    this.baseUrl = process.env.MEMORY_SELECT_API || 'https://memory-select-production.up.railway.app';
    this.timeout = parseInt(process.env.MEMORY_SELECT_TIMEOUT || '30000', 10);
  }

  /**
   * 添加记忆到 memory-select 服务
   * @param uid - 用户 ID
   * @param text - 记忆文本内容
   * @param metadata - 可选的元数据
   * @returns 添加结果
   */
  async addMemory(uid: string, text: string, metadata?: Record<string, any>): Promise<AddMemoryResponse> {
    const response = await axios.post(
      `${this.baseUrl}/api/v1/memory/add`,
      { uid, text, metadata },
      { timeout: this.timeout }
    );
    return response.data;
  }

  /**
   * 查询记忆并生成 AI 答案
   * @param query - 问题或搜索查询
   * @param limit - 最大返回结果数
   * @param uid - 可选的用户 ID 过滤器
   * @returns 查询结果和 AI 生成的答案
   */
  async selectWithAnswer(query: string, limit = 5, uid?: string): Promise<SelectWithAnswerResponse> {
    const response = await axios.post(
      `${this.baseUrl}/api/v1/memory/select_with_answer`,
      { query, limit, uid },
      { timeout: this.timeout }
    );
    return response.data;
  }
}

/**
 * 单例导出
 */
export const memorySelectService = new MemorySelectService();
