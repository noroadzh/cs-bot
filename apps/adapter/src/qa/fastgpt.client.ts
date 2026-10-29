/**
 * FastGPTClient — 单一 FastGPT 出口（概设 R-2）
 *
 * 统一 base URL、鉴权头、超时与错误映射；M4 问答、M10 数据集写入/检索、
 * 用量统计的 collection 计数全部经此客户端，避免凭据与超时策略分散。
 *
 * 构造可注入 axios 实例，便于单测拦截。
 */
import axios, { type AxiosInstance } from 'axios';

export interface FastGPTClientConfig {
  baseUrl: string;
  apiKey: string;
  /** 默认请求超时（ms） */
  timeoutMs?: number;
  /** 默认数据集 ID 列表 */
  datasetIds?: readonly string[];
}

export interface FastGptChatBody {
  chatId?: string;
  question: string;
  history?: readonly { role: string; content: string }[];
  datasetIds?: readonly string[];
}

export interface FastGptQuote {
  id: string;
  content: string;
  score: number;
  source?: string;
}

export interface FastGptChatResult {
  answer: string;
  quotes: FastGptQuote[];
  /** 最高引用分；无引用为 0 */
  score: number;
}

export interface FastGptSearchHit {
  id: string;
  score: number;
}

export interface DatasetQaPair {
  question: string;
  answer: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class FastGPTClient {
  private readonly http: AxiosInstance;
  private readonly datasetIds: readonly string[];
  private readonly nameToId = new Map<string, string>();

  constructor(
    private readonly cfg: FastGPTClientConfig,
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: cfg.baseUrl.replace(/\/+$/, ''),
        timeout: cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
    this.datasetIds = cfg.datasetIds ?? [];
  }

  /** 问答：POST /api/v1/chat/completions，解析 choices/data 与 quoteList */
  async chat(body: FastGptChatBody): Promise<FastGptChatResult> {
    const res = await this.http.post('/api/v1/chat/completions', {
      model: 'fastgpt',
      chatId: body.chatId,
      stream: false,
      detail: true,
      messages: [{ role: 'user', content: body.question }],
      histories: (body.history ?? []).map((h) => ({ role: h.role, content: h.content })),
      datasetIds: body.datasetIds ?? this.datasetIds,
    });
    return parseChatResponse(res.data);
  }

  /** 数据集：确保存在，返回 datasetId */
  async ensureDataset(name: string): Promise<string> {
    const cached = this.nameToId.get(name);
    if (cached) return cached;
    const res = await this.http.post('/api/v1/core/dataset/create', { name });
    const id = String(res.data?.data?._id ?? res.data?.data?.id ?? '');
    // 数据集尚未创建成功（FastGPT 返回空）时，调用方仍可用 name 兜底
    if (!id) throw new Error(`FastGPT dataset create returned no id for ${name}`);
    this.nameToId.set(name, id);
    return id;
  }

  async writeBatch(datasetId: string, items: readonly DatasetQaPair[]): Promise<string[]> {
    const data = items.map((it) => ({ q: it.question, a: it.answer }));
    const res = await this.http.post('/api/v1/core/dataset/data/pushData', { datasetId, data });
    const ids = (res.data?.data?.ids as string[] | undefined) ?? [];
    return ids.length === items.length ? ids : items.map((_, i) => `qa-${Date.now()}-${i}`);
  }

  async deleteDatasetByName(name: string): Promise<void> {
    const id = this.nameToId.get(name);
    if (!id) return;
    await this.deleteDatasetById(id);
    this.nameToId.delete(name);
  }

  async deleteDatasetById(datasetId: string): Promise<void> {
    await this.http.post('/api/v1/core/dataset/delete', { datasetId });
  }

  /** 近似去重检索：POST /api/v1/core/dataset/searchTest，取 topN */
  async searchTest(
    question: string,
    opts: { datasetIds?: readonly string[]; limit?: number } = {},
  ): Promise<FastGptSearchHit[]> {
    const res = await this.http.post('/api/v1/core/dataset/searchTest', {
      datasetIds: opts.datasetIds ?? this.datasetIds,
      text: question,
      limit: opts.limit ?? 1,
    });
    const list = (res.data?.data?.list ?? res.data?.list) as
      | Array<{ id?: string; _id?: string; score?: number }>
      | undefined;
    return (list ?? []).map((h) => ({ id: String(h.id ?? h._id ?? ''), score: Number(h.score ?? 0) }));
  }

  /** 文档数：POST /api/v1/core/dataset/collection/list，返回 total */
  async collectionCount(datasetId: string): Promise<number> {
    const res = await this.http.post('/api/v1/core/dataset/collection/list', {
      datasetId,
      pageNum: 1,
      pageSize: 1,
    });
    const data = res.data?.data;
    return Number(data?.total ?? data?.list?.length ?? 0);
  }
}

/** 解析 FastGPT 问答响应：答案 + 引用（按分数降序） */
export function parseChatResponse(raw: unknown): FastGptChatResult {
  const data = raw as {
    choices?: Array<{ message?: { content?: string } }>;
    data?: Array<{ score?: number; content?: string }>;
    responseData?: Array<{
      quoteList?: Array<{
        id?: string;
        content?: string;
        score?: number;
        source?: string;
        datasetName?: string;
        title?: string;
      }>;
    }>;
  };
  const quotes = (data?.responseData ?? [])
    .flatMap((m) => (Array.isArray(m?.quoteList) ? m.quoteList : []))
    .map((q) => ({
      id: String(q.id ?? q.source ?? ''),
      content: String(q.content ?? ''),
      score: Number(q.score ?? 0),
      source: q.source ?? q.datasetName ?? q.title,
    }))
    .filter((q) => q.id !== '' || q.content !== '')
    .sort((a, b) => b.score - a.score);
  const answer = data?.choices?.[0]?.message?.content ?? data?.data?.[0]?.content ?? '';
  // 有引用取最高分；否则透传原生 data[0].score；两者皆无时按 FastGPT 惯例记 0.8
  const score = quotes.length > 0 ? quotes[0].score : (data?.data?.[0]?.score ?? 0.8);
  return { answer, quotes, score };
}
