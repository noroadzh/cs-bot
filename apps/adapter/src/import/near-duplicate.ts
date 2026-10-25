/**
 * NearDuplicate — 近似去重（概设 §5 M10 步骤 7）
 *
 * 以「问」调 FastGPT 检索 top1，score ≥ 0.9 记 similar_qa_id 并默认建议丢弃。
 * 检索失败不阻塞（返回 null）。接口可注入，测试用 fake。
 */
import axios, { type AxiosInstance } from 'axios';

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
  private readonly http: AxiosInstance;

  constructor(
    private readonly cfg: {
      baseUrl: string;
      apiKey: string;
      datasetIds: string[];
      timeoutMs?: number;
    },
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: cfg.baseUrl,
        timeout: cfg.timeoutMs ?? 5000,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
  }

  async search(question: string): Promise<SearchHit | null> {
    try {
      const res = await this.http.post('/api/v1/core/dataset/searchTest', {
        datasetIds: this.cfg.datasetIds,
        text: question,
        limit: 1,
      });
      const list = (res.data?.data?.list ?? res.data?.list) as
        | Array<{ id?: string; _id?: string; score?: number }>
        | undefined;
      const top = list?.[0];
      if (!top) return null;
      return { id: String(top.id ?? top._id ?? ''), score: Number(top.score ?? 0) };
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
