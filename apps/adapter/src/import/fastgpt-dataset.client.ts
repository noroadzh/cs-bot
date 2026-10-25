/**
 * FastGptDatasetClient — 写入 FastGPT 独立数据集（概设 §5 M10 步骤 8）
 *
 * 接口可替换：默认 HTTP 实现调 FastGPT 数据集 API；测试/降级用 InMemory。
 * 批次 50、指数退避 3 次由调用方（ImportDatasetService）控制。
 */
import axios, { type AxiosInstance } from 'axios';

export interface DatasetQaPair {
  question: string;
  answer: string;
}

export interface DatasetClient {
  /** 确保数据集存在，返回 datasetId */
  ensureDataset(name: string): Promise<string>;
  /** 批量写入，返回各条 qa id（与入参同序） */
  writeBatch(datasetId: string, items: readonly DatasetQaPair[]): Promise<string[]>;
  /** 删除整个数据集（批次回滚） */
  deleteDataset(name: string): Promise<void>;
}

/** 默认 HTTP 实现 */
export class HttpFastGptDatasetClient implements DatasetClient {
  private readonly http: AxiosInstance;
  private readonly nameToId = new Map<string, string>();

  constructor(
    private readonly cfg: { baseUrl: string; apiKey: string; timeoutMs?: number },
    http?: AxiosInstance,
  ) {
    this.http =
      http ??
      axios.create({
        baseURL: cfg.baseUrl,
        timeout: cfg.timeoutMs ?? 10_000,
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
  }

  async ensureDataset(name: string): Promise<string> {
    const cached = this.nameToId.get(name);
    if (cached) return cached;
    const res = await this.http.post('/api/v1/core/dataset/create', { name });
    const id = String(res.data?.data?._id ?? res.data?.data?.id ?? '');
    this.nameToId.set(name, id);
    return id;
  }

  async writeBatch(datasetId: string, items: readonly DatasetQaPair[]): Promise<string[]> {
    const data = items.map((it) => ({ q: it.question, a: it.answer }));
    const res = await this.http.post('/api/v1/core/dataset/data/pushData', {
      datasetId,
      data,
    });
    const ids = (res.data?.data?.insertLen !== undefined
      ? Array.from({ length: items.length }, (_, i) => `batch-${Date.now()}-${i}`)
      : (res.data?.data?.ids as string[] | undefined)) ?? [];
    return ids.length === items.length ? ids : items.map((_, i) => `qa-${Date.now()}-${i}`);
  }

  async deleteDataset(name: string): Promise<void> {
    const id = this.nameToId.get(name);
    if (!id) return;
    await this.http.post('/api/v1/core/dataset/delete', { datasetId: id });
    this.nameToId.delete(name);
  }
}

/** 测试/降级：内存实现，记录写入 */
export class InMemoryDatasetClient implements DatasetClient {
  readonly datasets = new Map<string, DatasetQaPair[]>();
  private seq = 0;

  async ensureDataset(name: string): Promise<string> {
    if (!this.datasets.has(name)) this.datasets.set(name, []);
    return name;
  }

  async writeBatch(datasetId: string, items: readonly DatasetQaPair[]): Promise<string[]> {
    const arr = this.datasets.get(datasetId) ?? [];
    const ids: string[] = [];
    for (const it of items) {
      const id = `qa-${++this.seq}`;
      arr.push(it);
      ids.push(id);
    }
    this.datasets.set(datasetId, arr);
    return ids;
  }

  async deleteDataset(name: string): Promise<void> {
    this.datasets.delete(name);
  }
}
