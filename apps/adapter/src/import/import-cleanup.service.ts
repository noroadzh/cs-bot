/**
 * 导入保留期清理（详设 §7 定时任务）
 * 03:40 删除 >30 天 review.xlsx、>180 天 import_item 元数据。
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

const REVIEW_RETENTION_MS = 30 * 86_400_000;
const ITEM_RETENTION_DAYS = 180;

@Injectable()
export class ImportCleanupService implements OnModuleDestroy {
  private readonly logger = new AppLogger('ImportCleanupService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
  }

  @Cron('40 3 * * *', { timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const r = await this.cleanup();
      this.logger.log({ detail: 'import-cleanup', ...r });
    } catch (err) {
      this.logger.warn({ detail: 'import-cleanup-failed', err: (err as Error).message });
    }
  }

  async cleanup(nowMs = Date.now()): Promise<{ reviewFiles: number; items: number }> {
    let reviewFiles = 0;
    const base = join(process.cwd(), 'data', 'import');
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const f = join(base, e.name, 'review.xlsx');
        try {
          const st = await fs.stat(f);
          if (nowMs - st.mtimeMs > REVIEW_RETENTION_MS) {
            await fs.unlink(f);
            reviewFiles += 1;
          }
        } catch {
          /* 文件不存在：忽略 */
        }
      }
    } catch {
      /* 目录不存在：忽略 */
    }

    const res = await this.pool.query(
      `DELETE FROM import_item WHERE created_at < now() - interval '${ITEM_RETENTION_DAYS} days'`,
    );
    return { reviewFiles, items: res.rowCount ?? 0 };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
