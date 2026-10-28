/**
 * 容量用量快照：QA 对数、可用群数、素材 MB、FastGPT 文档数（best-effort）
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import axios from 'axios';
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

  constructor() {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
  }

  async snapshot(): Promise<CapacitySnapshot> {
    const [qa, chats] = await Promise.all([
      this.pool.query('SELECT COUNT(*)::int AS n FROM approved_qa').catch(() => ({ rows: [{ n: 0 }] })),
      this.pool.query('SELECT COUNT(*)::int AS n FROM licensed_chat').catch(() => ({ rows: [{ n: 0 }] })),
    ]);
    return {
      docCount: await this.countDocs(),
      qaCount: Number(qa.rows[0]?.n ?? 0),
      assetMb: await this.assetMb(),
      activeChats: Number(chats.rows[0]?.n ?? 0),
    };
  }

  private async countDocs(): Promise<number> {
    const cfg = ConfigService.instance;
    if (!cfg.FASTGPT_BASE_URL || !cfg.FASTGPT_API_KEY) return 0;
    const ids = (cfg.FASTGPT_DATASET_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    let total = 0;
    for (const datasetId of ids) {
      try {
        const res = await axios.post(
          `${cfg.FASTGPT_BASE_URL.replace(/\/$/, '')}/api/v1/core/dataset/collection/list`,
          { datasetId, pageNum: 1, pageSize: 1 },
          { timeout: 5000, headers: { Authorization: `Bearer ${cfg.FASTGPT_API_KEY}` } },
        );
        const data = res.data?.data;
        total += Number(data?.total ?? data?.list?.length ?? 0);
      } catch (err) {
        this.logger.warn({ detail: 'doc-count-failed', datasetId, err: (err as Error).message });
      }
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
