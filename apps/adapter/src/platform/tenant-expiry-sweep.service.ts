/**
 * TenantExpirySweepService — M11 过期扫描定时任务（spec tenant-registry, design D6）
 *
 * 每小时 cron：
 *   1. active  → grace      : expired_at < now
 *   2. grace   → paused     : expired_at < now - 7d
 *   3. paused  : daysSinceExpiry > 30 → 仅 flag，不自动销毁
 *
 * 每次自动转移写一条审计，actor 固定 'system:sweep'。
 */

import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { TenantStateMachine } from './tenant.state-machine.js';
import { PlatformAuditService } from './platform-audit.service.js';
import type { Tenant, TenantStatus } from './tenant.entity.js';

/** 每小时执行（3,600,000 ms） */
const SWEEP_INTERVAL_MS = 3_600_000;
/** grace 宽限期 */
export const GRACE_PERIOD_DAYS = 7;
/** paused 超过该天数 flag 提醒（不自动销毁） */
export const PAUSED_TERMINATION_DAYS = 30;

export interface SweepResult {
  scannedAt: string;
  expiredToGrace: string[];
  graceToPaused: string[];
  pausedFlagged: Array<{ tenantId: string; daysSinceExpiry: number }>;
  total: number;
}

@Injectable()
export class TenantExpirySweepService {
  private readonly logger = new AppLogger('TenantExpirySweepService');
  private readonly pool: Pool;

  constructor(
    private readonly audit: PlatformAuditService,
    _config: ConfigService,
  ) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  /** 定时入口：每小时执行一次 */
  @Interval(SWEEP_INTERVAL_MS)
  async handleSweep(): Promise<void> {
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error({
        detail: 'sweep-error',
        err: (err as Error).message,
      });
    }
  }

  /**
   * 单次扫描。幂等：重复调用不会对同一租户重复转移。
   */
  async sweep(nowMs = Date.now()): Promise<SweepResult> {
    const result: SweepResult = {
      scannedAt: new Date(nowMs).toISOString(),
      expiredToGrace: [],
      graceToPaused: [],
      pausedFlagged: [],
      total: 0,
    };

    // ---- 1. active → grace（过期未宽限） ----
    const expiredActive = await this.pool.query(
      `SELECT id, status, expired_at
       FROM tenant
       WHERE status = 'active'
         AND expired_at IS NOT NULL
         AND expired_at < $1
         AND deleted_at IS NULL`,
      [new Date(nowMs).toISOString()],
    );
    for (const row of expiredActive.rows) {
      const toStatus: TenantStatus = 'grace';
      try {
        TenantStateMachine.assertTransition('active', toStatus);
        const res = await this.pool.query(
          `UPDATE tenant SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'active'`,
          [String(row.id), toStatus],
        );
        if (res.rowCount === 1) {
          result.expiredToGrace.push(String(row.id));
          result.total++;
          await this.audit.append({
            action: 'tenant.expired-sweep',
            actor: 'system:sweep',
            tenantId: String(row.id),
            payload: { fromStatus: 'active', toStatus },
          });
        }
      } catch (err) {
        this.logger.warn({
          detail: 'sweep-transition-failed',
          tenantId: String(row.id),
          from: 'active',
          to: toStatus,
          err: (err as Error).message,
        });
      }
    }

    // ---- 2. grace → paused（宽限 >7 天） ----
    const graceExpired = await this.pool.query(
      `SELECT id, status, expired_at
       FROM tenant
       WHERE status = 'grace'
         AND expired_at IS NOT NULL
         AND expired_at < $1
         AND deleted_at IS NULL`,
      [new Date(nowMs - GRACE_PERIOD_DAYS * 86_400_000).toISOString()],
    );
    for (const row of graceExpired.rows) {
      const toStatus: TenantStatus = 'paused';
      try {
        TenantStateMachine.assertTransition('grace', toStatus);
        const res = await this.pool.query(
          `UPDATE tenant SET status = $2, updated_at = NOW() WHERE id = $1 AND status = 'grace'`,
          [String(row.id), toStatus],
        );
        if (res.rowCount === 1) {
          result.graceToPaused.push(String(row.id));
          result.total++;
          await this.audit.append({
            action: 'tenant.expired-sweep',
            actor: 'system:sweep',
            tenantId: String(row.id),
            payload: { fromStatus: 'grace', toStatus },
          });
        }
      } catch (err) {
        this.logger.warn({
          detail: 'sweep-transition-failed',
          tenantId: String(row.id),
          from: 'grace',
          to: toStatus,
          err: (err as Error).message,
        });
      }
    }

    // ---- 3. paused 超过 30 天 → flag（不自动销毁） ----
    const pausedRes = await this.pool.query(
      `SELECT id, status, expired_at
       FROM tenant
       WHERE status = 'paused'
         AND expired_at IS NOT NULL
         AND deleted_at IS NULL`,
    );
    for (const row of pausedRes.rows) {
      const daysSinceExpiry = Math.floor(
        (nowMs - new Date(String(row.expired_at)).getTime()) / 86_400_000,
      );
      if (daysSinceExpiry > PAUSED_TERMINATION_DAYS) {
        result.pausedFlagged.push({ tenantId: String(row.id), daysSinceExpiry });
        await this.audit.append({
          action: 'tenant.paused-sweep',
          actor: 'system:sweep',
          tenantId: String(row.id),
          payload: { daysSinceExpiry },
        });
      }
    }

    return result;
  }

  /** 读单个租户（供测试与 controller） */
  async getTenant(id: string): Promise<Tenant | null> {
    const res = await this.pool.query(
      `SELECT id, name, status, host, port, database_url, created_at, updated_at,
              expired_at, last_provision_log, deleted_at
       FROM tenant WHERE id = $1`,
      [id],
    );
    return res.rows.length > 0 ? mapTenantRow(res.rows[0]) : null;
  }
}

export function mapTenantRow(row: Record<string, unknown>): Tenant {
  return {
    id: String(row.id),
    name: String(row.name),
    status: String(row.status) as TenantStatus,
    host: row.host === null || row.host === undefined ? null : String(row.host),
    port: row.port === null || row.port === undefined ? null : Number(row.port),
    databaseUrl:
      row.database_url === null || row.database_url === undefined ? null : String(row.database_url),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
    expiredAt:
      row.expired_at === null || row.expired_at === undefined
        ? null
        : new Date(row.expired_at as string).toISOString(),
    lastProvisionLog:
      row.last_provision_log === null || row.last_provision_log === undefined
        ? null
        : String(row.last_provision_log),
    deletedAt:
      row.deleted_at === null || row.deleted_at === undefined
        ? null
        : new Date(row.deleted_at as string).toISOString(),
  };
}
