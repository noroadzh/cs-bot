/**
 * 数据面内部同步端点 + TenantGate 立即生效（真实 PG）
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { applyMigrations } from '../__setup__/migrations.js';
import { setConfig, resetConfig } from '../__setup__/test-helpers.js';
import { TenantSyncController } from '../../src/internal/tenant-sync.controller.js';
import { TenantGateService } from '../../src/license/tenant-gate.service.js';

jest.setTimeout(60_000);
const PG_URL = process.env.TEST_PG_URL;
const suite = PG_URL ? describe : describe.skip;

suite('内部 tenant sync', () => {
  let pool: Pool;
  let ctrl: TenantSyncController;
  const tenantId = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL, max: 5 });
    await applyMigrations(pool);
    await pool.query('DELETE FROM tenant_quota WHERE tenant_id = $1', [tenantId]);
    await pool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
    setConfig({ DATABASE_URL: PG_URL, TENANT_SYNC_TOKEN: 'sync-token', TENANT_ID: tenantId });
    ctrl = new TenantSyncController();
    (ctrl as any).pool = pool;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM tenant_quota WHERE tenant_id = $1', [tenantId]).catch(() => undefined);
    await pool.query('DELETE FROM tenant WHERE id = $1', [tenantId]).catch(() => undefined);
    await ctrl?.onModuleDestroy();
    await pool?.end().catch(() => undefined);
    resetConfig();
  });

  it('同步 status/quota 后 TenantGate 立即按新值执行', async () => {
    await ctrl.sync({
      tenantId,
      name: 'Sync租户',
      status: 'active',
      expiredAt: null,
      quota: { maxChats: 1, maxStorageMb: 1, maxApiCalls: 1, maxUsers: 1, maxLlmTokensPerMonth: 0 },
    });
    const row = await pool.query('SELECT status FROM tenant WHERE id=$1', [tenantId]);
    expect(row.rows[0].status).toBe('active');
    const q = await pool.query('SELECT max_api_calls FROM tenant_quota WHERE tenant_id=$1', [tenantId]);
    expect(q.rows[0].max_api_calls).toBe(1);

    const gate = new TenantGateService({} as any);
    expect(await gate.check(false)).toEqual({ allowed: true });
    // 第二次 api_call 超限（maxApiCalls=1）
    expect(await gate.check(false)).toEqual({ allowed: false, reason: 'tenant-msg-limit' });

    await ctrl.sync({ tenantId, name: 'Sync租户', status: 'suspended', quota: { maxChats: 1, maxApiCalls: 10 } });
    expect(await gate.check(false)).toEqual({ allowed: false, reason: 'tenant-inactive' });
  });
});
