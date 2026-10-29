/**
 * 容量用量快照：QA 对数、可用群数、素材 MB、FastGPT 文档数（best-effort）
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { FastGPTClient } from '../qa/fastgpt.client.js';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export interface CapacitySnapshot {
  docCount: number;
  qaCount: number;
  assetMb: number;
  activeChats: number;
}

@Injectable()
export class CapacityUsageService implements OnModuleDestroy {
  private readonly logger = new AppLogger('CapacityUsageService');
  private readonly pool: Pool;

  private readonly fastgpt: FastGPTClient | null;

  constructor(fastgpt?: FastGPTClient) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
    this.fastgpt = fastgpt ?? null;
  }

  /** 统一 FastGPT 访问：优先注入的客户端，否则按配置构造（R-2） */
  private fastgptClient(): FastGPTClient {
    if (this.fastgpt) return this.fastgpt;
    const cfg = ConfigService.instance;
    if (!cfg.FASTGPT_BASE_URL || !cfg.FASTGPT_API_KEY) {
      throw new Error('FASTGPT_BASE_URL/FASTGPT_API_KEY not configured');
    }
    return new FastGPTClient({
      baseUrl: cfg.FASTGPT_BASE_URL,
      apiKey: cfg.FASTGPT_API_KEY,
      timeoutMs: 5000,
      datasetIds: (cfg.FASTGPT_DATASET_IDS ?? '').split(',').map((x) => x.trim()).filter(Boolean),
    });
  }

  async snapshot(): Promise<CapacitySnapshot> {
    const [qa, chats] = await Promise.all([
      this.pool.query('SELECT COUNT(*)::int AS n FROM approved_qa').catch(() => ({ rows: [{ n: 0 }] })),
      this.pool.query('SELECT COUNT(*)::int AS n FROM licensed_chat').catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    return {
      docCount: await this.countDocuments(),
      qaCount: Number(qa.rows[0]?.n ?? 0),
      assetMb: await this.assetMb(),
      activeChats: Number(chats.rows[0]?.n ?? 0),
    };
  }

  /**
   * 文档数：以 FastGPT 数据集 collection 列表为准；任何失败都抛出，
   * 由调用方决定拒绝/重试，绝不以 0 代替。
   */
  async countDocuments(): Promise<number> {
    const cfg = ConfigService.instance;
    if (!cfg.FASTGPT_BASE_URL || !cfg.FASTGPT_API_KEY) {
      throw new Error('FASTGPT_BASE_URL/FASTGPT_API_KEY not configured');
    }
    const ids = (cfg.FASTGPT_DATASET_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return 0;
    const client = this.fastgptClient();
    let total = 0;
    for (const datasetId of ids) {
      total += await client.collectionCount(datasetId);
    }
    return total;
  }

  private async assetMb(): Promise<number> {
    const dir = join(process.cwd(), 'data', 'assets');
    const walk = async (path: string): Promise<number> => {
      let total = 0;
      let names: string[] = [];
      try {
        names = await fs.readdir(path);
      } catch {
        return 0;
      }
      for (const name of names) {
        const full = join(path, name);
        const stat = await fs.stat(full);
        total += stat.isDirectory() ? await walk(full) : stat.size;
      }
      return total;
    };
    return Number(((await walk(dir)) / 1024 / 1024).toFixed(2));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
