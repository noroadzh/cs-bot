/**
 * TenantExpirySweepService 单元测试（5.3）
 *
 * 覆盖：
 *   - sweep: happy path（active→grace、grace→paused、paused flag）、无操作空跑
 *   - 幂等：同一租户重复调用不重复转移（UPDATE rowCount=0 拦截）
 *   - getTenant: happy path、不存在返回 null
 *
 * pg Pool 全部 mock。
 *
 * 注：sweep 内部按「SELECT → UPDATE」交错调用（active SELECT、active UPDATE、
 * grace SELECT、grace UPDATE、paused SELECT），因此 mock 按 SQL 语义路由，
 * 不用脆弱的 mockResolvedValueOnce 顺序。
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

// ---------------------------------------------------------------------------
// Mock pg
// ---------------------------------------------------------------------------
const poolQuery = jest.fn<
  (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number }>
>();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function auditAppend() {
  return jest.fn<(e: unknown) => Promise<string>>().mockResolvedValue('hash-sweep');
}

function tenantRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 't1',
    name: 'tenant-1',
    status: 'active',
    host: '10.0.0.1',
    port: 80,
    database_url: 'postgresql://t:t@localhost:5432/t1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-10-15T00:00:00.000Z',
    expired_at: '2026-10-01T00:00:00.000Z',
    last_provision_log: null,
    deleted_at: null,
    ...over,
  };
}

const DAY_MS = 86_400_000;
/** 相对 now 的偏移，避免用例依赖固定日期 */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/**
 * 按 SQL 语义路由 mock。
 * activeRows / graceRows / pausedRows 决定三次 SELECT 的返回；
 * activeUpdateRowCount / graceUpdateRowCount 决定两次 UPDATE 的 rowCount。
 */
function mockSweep(opts: {
  activeRows?: Record<string, unknown>[];
  graceRows?: Record<string, unknown>[];
  pausedRows?: Record<string, unknown>[];
  activeUpdateRowCount?: number;
  graceUpdateRowCount?: number;
}) {
  const activeUpdateRowCount = opts.activeUpdateRowCount ?? 1;
  const graceUpdateRowCount = opts.graceUpdateRowCount ?? 1;
  let activeUpdates = 0;
  let graceUpdates = 0;

  poolQuery.mockImplementation(async (sql: string) => {
    const s = sql.trim();
    if (s.startsWith('SELECT')) {
      if (s.includes("status = 'active'")) {
        return { rows: opts.activeRows ?? [] };
      }
      if (s.includes("status = 'grace'")) {
        return { rows: opts.graceRows ?? [] };
      }
      if (s.includes("status = 'paused'")) {
        return { rows: opts.pausedRows ?? [] };
      }
      return { rows: [] };
    }
    if (s.startsWith('UPDATE')) {
      if (s.includes("status = 'active'")) {
        activeUpdates += 1;
        return { rows: [], rowCount: activeUpdates === 1 ? activeUpdateRowCount : 0 };
      }
      if (s.includes("status = 'grace'")) {
        graceUpdates += 1;
        return { rows: [], rowCount: graceUpdates === 1 ? graceUpdateRowCount : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [] };
  });
}

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------
import { TenantExpirySweepService } from '../src/platform/tenant-expiry-sweep.service.js';

function svc(audit?: { append: (e: unknown) => Promise<string> }) {
  return new TenantExpirySweepService((audit ?? { append: auditAppend() }) as any, {} as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TenantExpirySweepService', () => {
  beforeEach(() => {
    setConfig();
    poolQuery.mockReset();
  });
  afterEach(() => {
    resetConfig();
  });

  // =====================================================================
  // sweep
  // =====================================================================
  describe('sweep', () => {
    it('happy path: active→grace、grace→paused、paused flag', async () => {
      mockSweep({
        activeRows: [tenantRow({ status: 'active', id: 't-active', expired_at: daysAgo(10) })],
        graceRows: [tenantRow({ status: 'grace', id: 't-grace', expired_at: daysAgo(30) })],
        pausedRows: [tenantRow({ status: 'paused', id: 't-paused', expired_at: daysAgo(40) })],
      });

      const audit = { append: auditAppend() };
      const result = await svc(audit).sweep(Date.now());

      expect(result.expiredToGrace).toContain('t-active');
      expect(result.graceToPaused).toContain('t-grace');
      expect(result.pausedFlagged).toEqual(
        expect.arrayContaining([{ tenantId: 't-paused', daysSinceExpiry: expect.any(Number) }]),
      );
      expect(result.total).toBeGreaterThanOrEqual(2);
      // 每次自动转移写一条审计，actor 固定 system:sweep
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tenant.expired-sweep',
          actor: 'system:sweep',
          tenantId: 't-active',
        }),
      );
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tenant.paused-sweep', actor: 'system:sweep' }),
      );
    });

    it('无操作：全部状态正常', async () => {
      mockSweep({});

      const result = await svc().sweep(Date.now());

      expect(result.expiredToGrace).toHaveLength(0);
      expect(result.graceToPaused).toHaveLength(0);
      expect(result.pausedFlagged).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('幂等：UPDATE rowCount=0 不重复计数', async () => {
      // 第一次 sweep 转移成功；第二次 sweep 同租户 UPDATE rowCount=0 → 不再计数
      mockSweep({
        activeRows: [tenantRow({ status: 'active', id: 't1', expired_at: daysAgo(10) })],
        graceRows: [],
        pausedRows: [],
        activeUpdateRowCount: 1,
      });

      const r1 = await svc().sweep(Date.now());
      expect(r1.expiredToGrace).toContain('t1');

      // 第二次：rowCount=0（mock 实现里第 2 次 active UPDATE 返回 0）
      const r2 = await svc().sweep(Date.now());
      expect(r2.expiredToGrace).not.toContain('t1');
      expect(r2.total).toBe(0);
    });

    it('paused 未超 30 天 → 不 flag', async () => {
      mockSweep({
        pausedRows: [tenantRow({ status: 'paused', id: 't-recent', expired_at: daysAgo(3) })],
      });

      const result = await svc().sweep(Date.now());

      expect(result.pausedFlagged).toHaveLength(0);
    });
  });

  // =====================================================================
  // getTenant
  // =====================================================================
  describe('getTenant', () => {
    it('happy path: 返回映射后的 Tenant', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [tenantRow({ name: 'my-tenant' })] });

      const result = await svc().getTenant('t1');

      expect(result).not.toBeNull();
      expect(result?.name).toBe('my-tenant');
      expect(result?.status).toBe('active');
    });

    it('不存在 → null', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await svc().getTenant('missing');

      expect(result).toBeNull();
    });
  });
});
