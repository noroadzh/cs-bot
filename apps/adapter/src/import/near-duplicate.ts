/**
 * NearDuplicate — 近似去重（概设 §5 M10 步骤 7）
 *
 * 以「问」调 FastGPT 检索 top1，score ≥ 0.9 记 similar_qa_id 并默认建议丢弃。
 * 检索失败不阻塞（返回 null）。接口可注入，测试用 fake。
 */
import type { AxiosInstance } from 'axios';
import { FastGPTClient } from '../qa/fastgpt.client.js';

export interface SearchHit {
  id: string;
  score: number;
}

export interface FastGptSearchClient {
  search(question: string): Promise<SearchHit | null>;
}

export const DEFAULT_SIMILAR_THRESHOLD = 0.9;

/** 默认 HTTP 实现：FastGPT 检索测试端点（端点/参数按部署版本可配置） */
export class HttpFastGptSearchClient implements FastGptSearchClient {
  private readonly client: FastGPTClient;
  private readonly datasetIds: readonly string[];

  constructor(
    cfg: {
      baseUrl: string;
      apiKey: string;
      datasetIds: string[];
      timeoutMs?: number;
    },
    /** 可注入 FastGPTClient，或直接注入 axios 实例（测试用） */
    client?: FastGPTClient | AxiosInstance,
  ) {
    this.datasetIds = cfg.datasetIds;
    if (client && typeof (client as FastGPTClient).chat === 'function') {
      this.client = client as FastGPTClient;
    } else {
      this.client = new FastGPTClient(
        {
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          timeoutMs: cfg.timeoutMs ?? 5000,
          datasetIds: cfg.datasetIds,
        },
        client as AxiosInstance | undefined,
      );
    }
  }

  async search(question: string): Promise<SearchHit | null> {
    try {
      const hits = await this.client.searchTest(question, { datasetIds: this.datasetIds, limit: 1 });
      const top = hits[0];
      if (!top) return null;
      return { id: top.id, score: top.score };
    } catch {
      // 检索失败不阻塞导入
      return null;
    }
  }
}

/** 测试/降级：永远无命中 */
export class NoopSearchClient implements FastGptSearchClient {
  async search(_question?: string): Promise<SearchHit | null> {
    return null;
  }
}
