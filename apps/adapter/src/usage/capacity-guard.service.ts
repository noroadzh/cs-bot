/**
 * CapacityGuard — 数据面容量的本地执行（素材 / QA / 文档）
 */
import { HttpException, HttpStatus, Injectable, OnModuleDestroy } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { CapacityUsageService } from './capacity-usage.service.js';

const MB = 1024 * 1024;
const ASSET_DIR = join(process.cwd(), 'data', 'assets');

interface QuotaRow {
  max_qa: number;
  max_docs: number;
  max_asset_mb: number;
}

@Injectable()
export class CapacityGuard implements OnModuleDestroy {
  private readonly logger = new AppLogger('CapacityGuard');
  private readonly pool: Pool;

  constructor(private readonly capacity?: CapacityUsageService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
  }

  private get tenantId(): string {
    return ConfigService.instance.TENANT_ID || '';
  }

  private async quota(): Promise<QuotaRow | null> {
    if (!this.tenantId) return null;
    const res = await this.pool.query(
      'SELECT max_qa, max_docs, max_asset_mb FROM tenant_quota WHERE tenant_id = $1',
      [this.tenantId],
    );
    return res.rows.length === 0 ? null : (res.rows[0] as QuotaRow);
  }

  async checkAsset(newBytes: number): Promise<void> {
    const q = await this.quota();
    if (!q || Number(q.max_asset_mb) === 0) return;
    const used = await this.assetBytes();
    const limit = Number(q.max_asset_mb) * MB;
    if (used + newBytes > limit) {
      throw new HttpException(
        {
          errCode: 'TENANT_QUOTA_EXCEEDED',
          kind: 'max_asset_mb',
          usedMb: Number((used / MB).toFixed(2)),
          limitMb: Number(q.max_asset_mb),
        },
        HttpStatus.CONFLICT,
      );
    }
  }

  async checkImport(newQa: number, newDocs: number): Promise<void> {
    const q = await this.quota();
    if (!q) return;
    if (Number(q.max_qa) > 0) {
      const current = await this.count('approved_qa').catch(() => 0);
      if (current + newQa > Number(q.max_qa)) {
        throw new HttpException(
          {
            errCode: 'TENANT_QUOTA_EXCEEDED',
            kind: 'max_qa',
            used: current,
            limit: Number(q.max_qa),
          },
          HttpStatus.CONFLICT,
        );
      }
    }
    if (Number(q.max_docs) > 0) {
      if (!this.capacity) {
        throw new HttpException(
          { errCode: 'CAPACITY_USAGE_UNAVAILABLE', detail: 'document counter is not configured' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      let docs: number;
      try {
        docs = await this.capacity.countDocuments();
      } catch (err) {
        this.logger.warn({ detail: 'doc-count-failed', err: (err as Error).message });
        throw new HttpException(
          { errCode: 'CAPACITY_USAGE_UNAVAILABLE', detail: 'cannot read document count' },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      if (docs + newDocs > Number(q.max_docs)) {
        throw new HttpException(
          {
            errCode: 'TENANT_QUOTA_EXCEEDED',
            kind: 'max_docs',
            used: docs,
            limit: Number(q.max_docs),
          },
          HttpStatus.CONFLICT,
        );
      }
    }
  }

  private async count(table: 'approved_qa'): Promise<number> {
    const res = await this.pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
    return Number(res.rows[0]?.n ?? 0);
  }

  private async assetBytes(): Promise<number> {
    const walk = async (dir: string): Promise<number> => {
      let total = 0;
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return 0;
      }
      for (const name of names) {
        const full = join(dir, name);
        const stat = await fs.stat(full);
        total += stat.isDirectory() ? await walk(full) : stat.size;
      }
      return total;
    };
    return walk(ASSET_DIR);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
