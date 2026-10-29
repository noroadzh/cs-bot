/**
 * FastGptDatasetClient — 写入 FastGPT 独立数据集（概设 §5 M10 步骤 8）
 *
 * 接口可替换：默认 HTTP 实现调 FastGPT 数据集 API；测试/降级用 InMemory。
 * 批次 50、指数退避 3 次由调用方（ImportDatasetService）控制。
 */
import axios, { type AxiosInstance } from 'axios';
import { FastGPTClient } from '../qa/fastgpt.client.js';

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
  /** 按持久化 datasetId 删除（进程重启后仍可用） */
  deleteDatasetById?(datasetId: string): Promise<void>;
}

/** 默认 HTTP 实现：经统一 FastGPTClient（R-2） */
export class HttpFastGptDatasetClient implements DatasetClient {
  private readonly client: FastGPTClient;
  private readonly nameToId = new Map<string, string>();

  constructor(
    cfg: { baseUrl: string; apiKey: string; timeoutMs?: number },
    /** 可注入 FastGPTClient，或直接注入 axios 实例（测试用） */
    client?: FastGPTClient | AxiosInstance,
  ) {
    if (client && typeof (client as FastGPTClient).chat === 'function') {
      this.client = client as FastGPTClient;
    } else {
      this.client = new FastGPTClient(
        { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, timeoutMs: cfg.timeoutMs ?? 10_000 },
        client as AxiosInstance | undefined,
      );
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { response?: { status?: number } }).response?.status;
        if (status !== undefined && status < 500) throw err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  async ensureDataset(name: string): Promise<string> {
    const cached = this.nameToId.get(name);
    if (cached) return cached;
    const id = await this.withRetry(() => this.client.ensureDataset(name));
    this.nameToId.set(name, id);
    return id;
  }

  async writeBatch(datasetId: string, items: readonly DatasetQaPair[]): Promise<string[]> {
    return this.withRetry(() => this.client.writeBatch(datasetId, items));
  }

  async deleteDataset(name: string): Promise<void> {
    const id = this.nameToId.get(name);
    if (!id) return;
    await this.deleteDatasetById(id);
    this.nameToId.delete(name);
  }

  async deleteDatasetById(datasetId: string): Promise<void> {
    await this.withRetry(() => this.client.deleteDatasetById(datasetId));
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

  async deleteDatasetById(datasetId: string): Promise<void> {
    this.datasets.delete(datasetId);
  }
}
