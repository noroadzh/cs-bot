/** Request-level management audit (fail-open) */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export type AuditSurface = 'admin' | 'platform';

export interface AuditAppendInput {
  userId?: string | null;
  username: string;
  roleCode: string;
  method: string;
  path: string;
  status: number;
  costMs: number;
  clientIp: string;
  surface: AuditSurface;
}

export interface AuditListFilters {
  username?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

@Injectable()
export class AdminRequestAuditService implements OnModuleDestroy {
  private readonly logger = new AppLogger('AdminRequestAuditService');
  private readonly pool: Pool;

  constructor(_config: ConfigService) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 3 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  append(input: AuditAppendInput): void {
    setImmediate(() => {
      void this.pool
        .query(
          `INSERT INTO admin_audit_log
             (user_id, username, role_code, method, path, status, cost_ms, client_ip, surface)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            input.userId ?? null,
            input.username,
            input.roleCode,
            input.method,
            input.path,
            input.status,
            input.costMs,
            input.clientIp,
            input.surface,
          ],
        )
        .catch((err: unknown) => {
          this.logger.warn({ errCode: 'AUDIT_APPEND_FAILED', detail: String(err) });
        });
    });
  }

  async list(filters: AuditListFilters = {}): Promise<{
    total: number;
    limit: number;
    offset: number;
    rows: Array<{
      id: number;
      userId: string | null;
      username: string;
      roleCode: string;
      method: string;
      path: string;
      status: number;
      costMs: number;
      clientIp: string;
      surface: string;
      createdAt: string;
    }>;
  }> {
    const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
    const offset = Math.max(filters.offset ?? 0, 0);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.username) {
      params.push(filters.username.toLowerCase());
      where.push(`username = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`created_at >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`created_at <= $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countRes = await this.pool.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM admin_audit_log ${clause}`,
      params,
    );
    const total = Number(countRes.rows[0]?.c ?? 0);
    params.push(limit, offset);
    const res = await this.pool.query<{
      id: number;
      user_id: string | null;
      username: string;
      role_code: string;
      method: string;
      path: string;
      status: number;
      cost_ms: number;
      client_ip: string;
      surface: string;
      created_at: Date;
    }>(
      `SELECT id, user_id, username, role_code, method, path, status, cost_ms, client_ip, surface, created_at
       FROM admin_audit_log ${clause}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return {
      total,
      limit,
      offset,
      rows: res.rows.map((r) => ({
        id: r.id,
        userId: r.user_id,
        username: r.username,
        roleCode: r.role_code,
        method: r.method,
        path: r.path,
        status: r.status,
        costMs: r.cost_ms,
        clientIp: r.client_ip,
        surface: r.surface,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }
}
