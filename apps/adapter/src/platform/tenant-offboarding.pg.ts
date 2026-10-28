/**
 * PostgreSQL 实现：注销记录读写（控制面库）
 */
import type { Pool } from 'pg';
import type { TenantStatus } from './tenant.entity.js';
import type { OffboardingRecord, OffboardingRepo } from './tenant-offboarding.js';

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

export class PgOffboardingRepo implements OffboardingRepo {
  constructor(private readonly db: Queryable) {}

  static fromPool(pool: Pool): PgOffboardingRepo {
    return new PgOffboardingRepo(pool);
  }

  async getTenantStatus(tenantId: string): Promise<TenantStatus | null> {
    const res = await this.db.query(
      `SELECT status FROM tenant WHERE id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    return res.rows.length === 0 ? null : (String(res.rows[0].status) as TenantStatus);
  }

  async get(tenantId: string): Promise<OffboardingRecord | null> {
    const res = await this.db.query(
      `SELECT tenant_id, status, approvals, confirm_token_hash, token_expires_at, export_path, delete_after
         FROM tenant_offboarding WHERE tenant_id = $1
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId],
    );
    return res.rows.length === 0 ? null : mapRecord(res.rows[0]);
  }

  async saveExport(
    tenantId: string,
    data: { exportPath: string; tokenHash: string; tokenExpiresAt: string },
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO tenant_offboarding
         (tenant_id, status, export_path, confirm_token_hash, token_expires_at, approvals)
       VALUES ($1, 'exported', $2, $3, $4, '[]'::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE
         SET status = 'exported',
             export_path = EXCLUDED.export_path,
             confirm_token_hash = EXCLUDED.confirm_token_hash,
             token_expires_at = EXCLUDED.token_expires_at,
             approvals = '[]'::jsonb,
             delete_after = NULL,
             destroyed_at = NULL,
             confirmation = NULL,
             created_at = NOW()`,
      [tenantId, data.exportPath, data.tokenHash, data.tokenExpiresAt],
    );
  }

  async schedule(tenantId: string, approvals: string[], deleteAfter: string): Promise<void> {
    await this.db.query(
      `UPDATE tenant_offboarding
          SET status = 'offboarding',
              approvals = $2::jsonb,
              delete_after = $3,
              confirm_token_hash = NULL,
              token_expires_at = NULL
        WHERE tenant_id = $1`,
      [tenantId, JSON.stringify(approvals), deleteAfter],
    );
  }

  async setTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
    await this.db.query(
      `UPDATE tenant SET status = $2, updated_at = NOW() WHERE id = $1`,
      [tenantId, status],
    );
  }

  async due(nowIso: string): Promise<string[]> {
    const res = await this.db.query(
      `SELECT tenant_id
         FROM tenant_offboarding
        WHERE status = 'offboarding'
          AND delete_after IS NOT NULL
          AND delete_after <= $1
        ORDER BY delete_after ASC`,
      [nowIso],
    );
    return res.rows.map((r) => String(r.tenant_id));
  }

  async markDestroyed(
    tenantId: string,
    data: { approvals: string[]; exportPath: string | null; deletedAt: string },
  ): Promise<void> {
    const confirmation = {
      deletedAt: data.deletedAt,
      exportPath: data.exportPath,
      approvals: data.approvals,
    };
    await this.db.query(
      `UPDATE tenant_offboarding
          SET status = 'destroyed', destroyed_at = $2, confirmation = $3::jsonb
        WHERE tenant_id = $1`,
      [tenantId, data.deletedAt, JSON.stringify(confirmation)],
    );
    await this.db.query(
      `INSERT INTO tenant_destroy_confirmation
         (tenant_id, deleted_at, package_path, approvals, details)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        tenantId,
        data.deletedAt,
        data.exportPath,
        JSON.stringify(data.approvals),
        JSON.stringify(confirmation),
      ],
    );
  }
}

function mapRecord(row: Record<string, unknown>): OffboardingRecord {
  return {
    tenantId: String(row.tenant_id),
    status: String(row.status) as OffboardingRecord['status'],
    approvals: Array.isArray(row.approvals) ? (row.approvals as string[]) : [],
    confirmTokenHash:
      row.confirm_token_hash === null || row.confirm_token_hash === undefined
        ? null
        : String(row.confirm_token_hash),
    tokenExpiresAt:
      row.token_expires_at === null || row.token_expires_at === undefined
        ? null
        : new Date(row.token_expires_at as string).toISOString(),
    exportPath:
      row.export_path === null || row.export_path === undefined ? null : String(row.export_path),
    deleteAfter:
      row.delete_after === null || row.delete_after === undefined
        ? null
        : new Date(row.delete_after as string).toISOString(),
  };
}
