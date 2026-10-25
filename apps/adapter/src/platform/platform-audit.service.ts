/**
 * PlatformAuditService — M11 平台审计链（spec platform-audit）
 *
 * 核心机制：
 *   1. append 在同一事务内 SELECT … FOR UPDATE 取 prev_hash → sha256 计算本行 hash → INSERT
 *   2. 链式防篡改：每行 hash = sha256(canonical(prev_hash, action, actor, tenant_id, payload, created_at))
 *   3. audit 写入失败不回滚业务，仅 error 日志
 *   4. verifyChain 全链重算，返回第一个断裂点
 */

import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { PlatformAuditLog, PlatformAuditAction } from './tenant.entity.js';

export interface AuditAppendOpts {
  action: PlatformAuditAction;
  actor: string;
  tenantId: string | null;
  payload: Record<string, unknown>;
}

export interface AuditListFilters {
  tenantId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditListResult {
  total: number;
  limit: number;
  offset: number;
  rows: PlatformAuditLog[];
}

export interface AuditVerifyResult {
  valid: boolean;
  brokenAtId?: string;
  entries: number;
}

@Injectable()
export class PlatformAuditService {
  private readonly logger = new AppLogger('PlatformAuditService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  // -------------------------------------------------------------------------
  // append — 事务内写审计行，链式哈希
  // -------------------------------------------------------------------------

  /**
   * 写一条审计记录。失败不回滚业务（仅 error 日志）。
   * @returns 写入行的 hash，失败返回 null
   */
  async append(opts: AuditAppendOpts): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // FOR UPDATE 锁住最后一行（防止并发分叉）；按 seq（插入顺序）而非随机 UUID
      const lastRes = await client.query(
        'SELECT hash FROM platform_audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE',
      );
      const prevHash = lastRes.rows.length > 0 ? String(lastRes.rows[0].hash) : '';

      const createdAt = new Date().toISOString();
      const hash = computeHash({
        prev_hash: prevHash,
        action: opts.action,
        actor: opts.actor,
        tenant_id: opts.tenantId ?? '',
        payload: opts.payload,
        created_at: createdAt,
      });

      await client.query(
        `INSERT INTO platform_audit_log
           (tenant_id, action, actor, payload, prev_hash, hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          opts.tenantId ?? null,
          opts.action,
          opts.actor,
          JSON.stringify(opts.payload),
          prevHash,
          hash,
          createdAt,
        ],
      );

      await client.query('COMMIT');
      return hash;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      // audit 失败不回滚业务
      this.logger.error({
        detail: 'audit-append-failed',
        action: opts.action,
        tenantId: opts.tenantId,
        err: (err as Error).message,
      });
      return null;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // list — 分页 + 过滤
  // -------------------------------------------------------------------------

  async list(filters: AuditListFilters = {}): Promise<AuditListResult> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.tenantId) {
      params.push(filters.tenantId);
      where.push(`tenant_id = $${params.length}`);
    }
    if (filters.action) {
      params.push(filters.action);
      where.push(`action = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`created_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`created_at <= $${params.length}`);
    }

    const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    const [dataRes, countRes] = await Promise.all([
      this.pool.query(
        `SELECT id, tenant_id, action, actor, payload, prev_hash, hash, created_at
         FROM platform_audit_log
         ${whereSql}
         ORDER BY created_at DESC, seq DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS n FROM platform_audit_log ${whereSql}`,
        params,
      ),
    ]);

    return {
      total: Number(countRes.rows[0]?.n ?? 0),
      limit,
      offset,
      rows: dataRes.rows.map(mapAuditRow),
    };
  }

  // -------------------------------------------------------------------------
  // verifyChain — 全链哈希校验
  // -------------------------------------------------------------------------

  async verifyChain(): Promise<AuditVerifyResult> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, action, actor, payload, prev_hash, hash, created_at
       FROM platform_audit_log
       ORDER BY seq ASC`,
    );
    const rows = res.rows;
    let prevHash = '';

    for (const row of rows) {
      // prev_hash 必须等于前一条的 hash（首条为 ''）——删中间行会在这里断
      if (String(row.prev_hash) !== prevHash) {
        return { valid: false, brokenAtId: String(row.id), entries: rows.length };
      }
      const computedHash = computeHash({
        prev_hash: prevHash,
        action: String(row.action),
        actor: String(row.actor),
        tenant_id: row.tenant_id === null ? '' : String(row.tenant_id),
        payload: parsePayload(row.payload),
        created_at: new Date(row.created_at as string).toISOString(),
      });
      // hash 必须与重算值一致——改 payload 会被这里抓到
      if (computedHash !== String(row.hash)) {
        return { valid: false, brokenAtId: String(row.id), entries: rows.length };
      }
      prevHash = String(row.hash);
    }

    return { valid: true, entries: rows.length };
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

/** 递归按 key 排序的规范序列化（数组保持原序） */
export function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      out[key] = canonicalValue(obj[key]);
    }
    return out;
  }
  return value;
}

/** 审计行的规范序列化字符串 */
export function canonicalSerialize(obj: Record<string, unknown>): string {
  return JSON.stringify(canonicalValue(obj));
}

/** 审计行的 hash：sha256(canonical) */
export function computeHash(fields: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalSerialize(fields)).digest('hex');
}

function parsePayload(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed !== null && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function mapAuditRow(row: Record<string, unknown>): PlatformAuditLog {
  return {
    id: String(row.id),
    tenantId: row.tenant_id === null || row.tenant_id === undefined ? '' : String(row.tenant_id),
    action: String(row.action),
    actor: String(row.actor),
    payload: parsePayload(row.payload),
    prevHash: String(row.prev_hash),
    hash: String(row.hash),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}
