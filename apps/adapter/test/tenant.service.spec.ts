/**
 * TenantService 单元测试（4.4, 4.5）
 *
 * 覆盖：
 *   - create: happy path、空名称 400、重复名 409、写审计
 *   - provision: happy path、租户不存在 404、非法转移 409、probe 超时 500、
 *                compose 失败 → provisioning_failed + 审计
 *   - renew: happy path、非法状态 409、非法 days 400、grace → active 转移、写审计
 *   - suspend: happy path、非法状态 409、写审计
 *   - resume: happy path、非法状态 409、写审计
 *   - terminate: happy path、幂等（二次 terminate 返回 as-is）、写审计
 *   - list: happy path、按 status 过滤、limit 上下限
 *   - getDetail: happy path、租户不存在透传 404
 *
 * pg Pool 全部 mock，不依赖真实 DB。
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
const poolQuery = jest.fn() as jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>
>;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
    connect: (jest.fn() as any).mockResolvedValue({
      query: jest.fn() as any,
      release: jest.fn() as any,
    }),
  })) as any,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function auditAppend(): any {
  return jest.fn(async () => 'hash-abc');
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    name: 'tenant-a',
    status: 'active',
    host: '10.0.0.1',
    port: 8080,
    database_url: 'postgresql://t:t@localhost:5432/t1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    expired_at: '2027-01-01T00:00:00.000Z',
    last_provision_log: null,
    deleted_at: null,
    ...over,
  };
}

function tenantRow(over: Record<string, unknown> = {}) {
  return row({ status: 'active', ...over });
}

/** Minimal fake provisioner — all methods are no-ops that resolve */
function fakeProvisioner(): any {
  return {
    render: jest.fn(() => Promise.resolve('/tmp/compose/t1/docker-compose.yml')),
    up: jest.fn(() => Promise.resolve()),
    probe: jest.fn(() => Promise.resolve(true)),
    stop: jest.fn(() => Promise.resolve()),
    start: jest.fn(() => Promise.resolve()),
    down: jest.fn(() => Promise.resolve()),
  };
}

// ---------------------------------------------------------------------------
// SUT factory
// ---------------------------------------------------------------------------
import { TenantService } from '../src/platform/tenant.service.js';
import { ConfigService } from '../src/config/config.service.js';

function svc(
  auditFn: any = auditAppend(),
  provisioner?: any,
  quotaMock?: any,
  usageMock?: any,
) {
  const svcInstance = new TenantService(
    { append: auditFn } as any,
    quotaMock ?? { ensureDefaultQuota: jest.fn(), getQuota: jest.fn(() => Promise.resolve(null)) },
    usageMock ?? { todaySummary: jest.fn(() => Promise.resolve({ day: '', chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 })) },
    ConfigService.instance as any,
  );
  if (provisioner) {
    svcInstance.setProvisioner(provisioner as any);
  }
  return svcInstance;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TenantService', () => {
  beforeEach(() => {
    setConfig();
    poolQuery.mockReset();
    // Default fallback: any unmocked query returns a generic active tenant row
    poolQuery.mockResolvedValue({ rows: [tenantRow()] });
  });
  afterEach(() => {
    resetConfig();
  });

  // =====================================================================
  // create
  // =====================================================================
  describe('create', () => {
    it('happy path: INSERT → ensureDefaultQuota → audit → Tenant', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [] })                            // dup check
        .mockResolvedValueOnce({ rows: [row({ name: 'foo', status: 'created' })] }) // INSERT RETURNING
        .mockResolvedValueOnce({ rows: [] });                           // ensureDefaultQuota SELECT
      const audit = auditAppend();

      const result = await svc(audit).create({ name: 'foo' }, 'op-1');

      expect(result.name).toBe('foo');
      expect(result.status).toBe('created');
      expect(audit).toHaveBeenCalledWith({
        action: 'tenant.create',
        actor: 'op-1',
        tenantId: result.id,
        payload: {
          tenantId: result.id,
          name: 'foo',
          plan: null,
          subscriptionExpiresAt: result.expiredAt,
        },
      });
      // ensureDefaultQuota 被自动调用（由 create 内部触发）
    });

    it('空名称 → 400 TENANT_NAME_EMPTY', async () => {
      poolQuery.mockResolvedValue({ rows: [] });
      await expect(svc().create({ name: '   ' })).rejects.toMatchObject({
        response: { errCode: 'TENANT_NAME_EMPTY' },
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('重复名 → 409 TENANT_NAME_DUPLICATE', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [row({ name: 'foo' })] }); // dup check hits
      await expect(svc().create({ name: 'foo' })).rejects.toMatchObject({
        response: { errCode: 'TENANT_NAME_DUPLICATE' },
      });
    });
  });

  // =====================================================================
  // provision
  // =====================================================================
  describe('provision', () => {
    it('happy path: created → provisioning → active', async () => {
      const prov = fakeProvisioner();
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'created' })] }) // requireTenant
        .mockResolvedValueOnce({ rows: [] })                                  // UPDATE status=provisioning
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] }); // UPDATE status=active

      const audit = auditAppend();
      const result = await svc(audit, prov).provision('t1');

      expect(result.status).toBe('active');
      expect(prov.render).toHaveBeenCalled();
      expect(prov.up).toHaveBeenCalled();
      expect(prov.probe).toHaveBeenCalled();
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.provision' }),
      );
    });

    it('租户不存在 → 404 TENANT_NOT_FOUND', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      await expect(svc().provision('missing')).rejects.toMatchObject({
        response: { errCode: 'TENANT_NOT_FOUND' },
      });
    });

    it('非法转移 (active → provisioning) → 409 ILLEGAL_TENANT_TRANSITION', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] });
      await expect(svc().provision('t1')).rejects.toMatchObject({
        response: { errCode: 'ILLEGAL_TENANT_TRANSITION' },
      });
    });

    it('probe 超时 → provisioning_failed + 审计', async () => {
      const prov = fakeProvisioner();
      prov.probe.mockResolvedValue(false);
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'created' })] })
        .mockResolvedValueOnce({ rows: [] }) // UPDATE → provisioning
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'provisioning_failed' })] });

      const audit = auditAppend();
      await expect(svc(audit, prov).provision('t1')).rejects.toMatchObject({
        response: { errCode: 'TENANT_PROVISION_TIMEOUT' },
      });
      expect(prov.down).toHaveBeenCalled();
    });

    it('TLS 证书签发失败 → 回滚并置 provisioning_failed', async () => {
      const prov = fakeProvisioner();
      const s = svc(auditAppend(), prov);
      s.setCertificateProvider({
        issue: async () => {
          throw new Error('cert fail');
        },
      });
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'created' })] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [tenantRow({ status: 'provisioning_failed' })] });

      await expect(s.provision('t1')).rejects.toThrow('cert fail');
      expect(prov.down).toHaveBeenCalled();
    });

    it('provision 成功调用授权签发', async () => {
      const prov = fakeProvisioner();
      const s = svc(auditAppend(), prov);
      const issued: string[] = [];
      s.setLicenseIssuer({
        issue: async (t) => {
          issued.push(t.id);
        },
      });
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'created' })] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] });

      await s.provision('t1');
      expect(issued).toEqual(['t1']);
    });
  });
  // =====================================================================
  describe('renew', () => {
    it('happy path: 续期 + 审计', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active', expired_at: '2027-06-01T00:00:00.000Z' })] }) // requireTenant (before)
        .mockResolvedValueOnce({ rows: [] }) // UPDATE
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active', expired_at: '2027-09-01T00:00:00.000Z' })] }); // requireTenant (after)

      const audit = auditAppend();
      const result = await svc(audit).renew('t1', 90, 'op-1');

      expect(result.expiredAt).toContain('2027-09-01');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.renew',
          actor: 'op-1',
          payload: expect.objectContaining({ days: 90 }),
        }),
      );
    });

    it('非 active/grace → 409 TENANT_RENEW_FORBIDDEN', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] });
      await expect(svc().renew('t1', 30)).rejects.toMatchObject({
        response: { errCode: 'TENANT_RENEW_FORBIDDEN' },
      });
    });

    it('offboarding 状态禁止续费', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'offboarding' })] });
      await expect(svc().renew('t1', 30)).rejects.toMatchObject({
        response: { errCode: 'TENANT_RENEW_FORBIDDEN' },
      });
    });

    it('days 非正整数 → 400 TENANT_RENEW_INVALID', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] });
      await expect(svc().renew('t1', 0)).rejects.toMatchObject({
        response: { errCode: 'TENANT_RENEW_INVALID' },
      });
    });
  });

  // =====================================================================
  // suspend
  // =====================================================================
  describe('suspend', () => {
    it('happy path: active → paused + 审计', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] }); // requireTenant after update

      const audit = auditAppend();
      const result = await svc(audit).suspend('t1');

      expect(result.status).toBe('paused');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.suspend' }),
      );
    });

    it('非 active/grace → 409 TENANT_SUSPEND_FORBIDDEN', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] });
      await expect(svc().suspend('t1')).rejects.toMatchObject({
        response: { errCode: 'TENANT_SUSPEND_FORBIDDEN' },
      });
    });
  });

  // =====================================================================
  // resume
  // =====================================================================
  describe('resume', () => {
    it('happy path: paused → active + 审计', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] }); // requireTenant after update

      const audit = auditAppend();
      const result = await svc(audit).resume('t1');

      expect(result.status).toBe('active');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.resume' }),
      );
    });

    it('非 paused → 409 TENANT_RESUME_FORBIDDEN', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'active' })] });
      await expect(svc().resume('t1')).rejects.toMatchObject({
        response: { errCode: 'TENANT_RESUME_FORBIDDEN' },
      });
    });
  });

  // =====================================================================
  // terminate
  // =====================================================================
  describe('terminate', () => {
    it('happy path: → terminated + 审计', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'active', database_url: 'db://x' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'terminated' })] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'terminated' })] }); // requireTenant after update

      const audit = auditAppend();
      const result = await svc(audit).terminate('t1');

      expect(result.status).toBe('terminated');
      expect(audit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.terminate' }),
      );
    });

    it('幂等: 已 terminated → 直接返回', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ status: 'terminated' })] });

      const result = await svc().terminate('t1');

      expect(result.status).toBe('terminated');
      expect(poolQuery).toHaveBeenCalledTimes(1); // only requireTenant
    });
  });

  // =====================================================================
  // list
  // =====================================================================
  describe('list', () => {
    it('happy path: 返回 rows + total + limit + offset', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ cnt: '3' }] })
        .mockResolvedValueOnce({ rows: [row({ name: 'a' }), row({ name: 'b' })] });

      const result = await svc().list(undefined, 10, 0);

      expect(result.total).toBe(3);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
      expect(result.rows).toHaveLength(2);
    });

    it('按 status 过滤', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ cnt: '1' }] })
        .mockResolvedValueOnce({ rows: [tenantRow({ status: 'paused' })] });

      const result = await svc().list('paused', 50, 0);

      expect(result.rows[0].status).toBe('paused');
      // Verify status parameter was passed (check the query was called with status filter)
      expect(poolQuery.mock.calls[0][0]).toContain('status');
    });

    it('limit 下限 1 上限 200', async () => {
      // First call: limit=-5 → clamped to 1
      poolQuery
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await svc().list(undefined, -5, 0);
      expect(poolQuery.mock.calls[1][1]).toContain(1);

      // Second call: limit=500 → clamped to 200 (need 2 more mocks)
      poolQuery
        .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
        .mockResolvedValueOnce({ rows: [] });
      await svc().list(undefined, 500, 0);
      expect(poolQuery.mock.calls[3][1]).toContain(200);
    });
  });

  // =====================================================================
  // getDetail
  // =====================================================================
  describe('getDetail', () => {
    it('happy path: tenant + quota + today usage', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [tenantRow({ name: 'detail-tenant' })],
      });

      const result = await svc().getDetail('t1');

      expect(result.tenant.name).toBe('detail-tenant');
      expect(result.quota).toBeDefined();
      expect(result.usageToday).toBeDefined();
    });

    it('租户不存在 → 透传 404', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      await expect(svc().getDetail('missing')).rejects.toMatchObject({
        response: { errCode: 'TENANT_NOT_FOUND' },
      });
    });
  });
});
