/** MissService */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { currentTenantId } from '../common/tenant-scope.js';

export interface MissRecord {
  traceId: string; chatId: string; userId: string;
  question: string; score: number; engine: string; ts: string;
  /** 触发消息为 voice/video/file 时的类型标记；文本未命中为空 */
  mediaType?: string;
}

const FIFO_MAX = 1000;

@Injectable()
export class MissService implements OnModuleDestroy {
  private readonly logger = new AppLogger('MissService');
  private readonly pool: Pool;
  private fifo: MissRecord[] = [];

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  async record(data: MissRecord): Promise<void> {
    setImmediate(() => this.flushOne(data));
  }

  /** 更新未命中处理状态：0 未处理 / 1 已补录 / 2 忽略 */
  async updateStatus(id: number, status: 0 | 1 | 2): Promise<boolean> {
    const tenantId = currentTenantId();
    const res = await this.pool.query(
      `UPDATE miss_record SET status = $2 WHERE id = $1 AND tenant_id = $3`,
      [id, status, tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  private async flushOne(data: MissRecord): Promise<void> {
    const tenantId = currentTenantId();
    try {
      await this.pool.query(
        `INSERT INTO miss_record (trace_id, chat_id, user_id, question, score, engine, media_type, tenant_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [
          data.traceId,
          data.chatId,
          data.userId,
          data.question,
          data.score,
          data.engine,
          data.mediaType ?? null,
          tenantId,
        ],
      );
    } catch (err) {
      this.logger.error({ detail: 'miss-record-fail', err: (err as Error).message });
      this.fifo.push(data);
      if (this.fifo.length > FIFO_MAX) this.fifo.shift();
      setTimeout(() => this.retry(), 5000);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  private async retry(): Promise<void> {
    if (this.fifo.length === 0) return;
    const data = this.fifo.shift()!;
    const tenantId = currentTenantId();
    try {
      await this.pool.query(
        `INSERT INTO miss_record (trace_id, chat_id, user_id, question, score, engine, media_type, tenant_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
        [
          data.traceId,
          data.chatId,
          data.userId,
          data.question,
          data.score,
          data.engine,
          data.mediaType ?? null,
          tenantId,
        ],
      );
    } catch {
      this.fifo.unshift(data);
      setTimeout(() => this.retry(), 15000);
    }
  }
}
