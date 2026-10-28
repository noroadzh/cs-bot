/**
 * 导入单任务租约（单行表 import_lock）
 *
 * 同一时刻只允许一个 job 处于 parsing/pairing/importing；30s 心跳，
 * 10 分钟无心跳可被接管；进程重启时清理残留锁，保证下一次请求立即恢复。
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppLogger } from '../common/logger.js';
import { affectedCount } from './import-mappers.js';

const LEASE_STALE_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30_000;

export class ImportLock {
  private readonly logger = new AppLogger('ImportLock');
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async acquire(jobId: string, stage: string): Promise<void> {
    const res = await this.pool.query(
      `INSERT INTO import_lock (id, job_id, stage, heartbeat_at)
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE
         SET job_id = EXCLUDED.job_id, stage = EXCLUDED.stage, heartbeat_at = NOW()
         WHERE import_lock.heartbeat_at < NOW() - interval '10 minutes'
       RETURNING job_id`,
      [jobId, stage],
    );
    if (affectedCount(res) === 0) {
      const active = await this.pool.query('SELECT job_id FROM import_lock WHERE id = 1');
      throw new HttpException(
        {
          errCode: 'IMPORT_BUSY',
          detail: 'another import job is running',
          activeJobId: active.rows[0]?.job_id ?? null,
        },
        HttpStatus.CONFLICT,
      );
    }
    this.heartbeatTimer = setInterval(() => {
      void this.pool
        .query('UPDATE import_lock SET heartbeat_at = NOW() WHERE id = 1 AND job_id = $1', [jobId])
        .catch(() => undefined);
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
  }

  async release(jobId: string): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    await this.pool
      .query('DELETE FROM import_lock WHERE id = 1 AND job_id = $1', [jobId])
      .catch(() => undefined);
  }

  /** 崩溃后运维强制释放 */
  async forceRelease(): Promise<{ released: boolean }> {
    const res = await this.pool.query('DELETE FROM import_lock WHERE id = 1 RETURNING job_id');
    const released = affectedCount(res) > 0;
    this.logger.warn({ detail: 'import-lock-force-released', released, jobId: res.rows[0]?.job_id ?? null });
    return { released };
  }

  /** 进程启动时清理上一个进程遗留的锁（单实例部署前提） */
  async resetOnBoot(): Promise<void> {
    const res = await this.pool.query('DELETE FROM import_lock WHERE id = 1 RETURNING job_id');
    if (affectedCount(res) > 0) {
      this.logger.warn({
        detail: 'import-lock-reset-on-boot',
        staleJobId: res.rows[0]?.job_id ?? null,
        staleLeaseMs: LEASE_STALE_MS,
      });
    }
  }
}
