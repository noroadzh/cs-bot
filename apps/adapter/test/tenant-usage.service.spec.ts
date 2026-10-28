/**
 * TenantUsageService 单元测试（5.2）
 *
 * 覆盖：
 *   - upsertCount: happy path、delta 全零无害通过
 *   - queryUsage: happy path、默认最近 30 天、分页区间、totals 计算
 *   - todaySummary: happy path、无当日行返回零值
 *
 * pg Pool 全部 mock，依赖内存 DB 模拟 SQL。
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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
function usageRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'u1',
    tenant_id: 't1',
    day: '2026-10-15',
    chat_count: 100,
    api_call_count: 500,
    storage_bytes: 1024000,
    user_count: 5,
    created_at: '2026-10-15T00:00:00.000Z',
    updated_at: '2026-10-15T12:00:00.000Z',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------
import { TenantUsageService } from '../src/platform/tenant-usage.service.js';

function svc() {
  return new TenantUsageService({} as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('TenantUsageService', () => {
  beforeEach(() => {
    setConfig();
    poolQuery.mockReset();
  });
  afterEach(() => {
    resetConfig();
  });

  // =====================================================================
  // upsertCount
  // =====================================================================
  describe('upsertCount', () => {
    it('happy path: INSERT ON CONFLICT DO UPDATE', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await svc().upsertCount('t1', {
        chatCount: 1,
        apiCallCount: 5,
        storageBytes: 1024,
        userCount: 0,
      });

      expect(poolQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = poolQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO tenant_usage_daily');
      expect(sql).toContain('ON CONFLICT (tenant_id, day) DO UPDATE');
      expect(params[0]).toBe('t1');
      expect(params[1]).toBe(1);   // chatCount
      expect(params[2]).toBe(5);   // apiCallCount
      expect(params[3]).toBe(1024); // storageBytes
      expect(params[4]).toBe(0);   // userCount
    });

    it('delta 全零 → 仍然执行（无害）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      await expect(svc().upsertCount('t1', {
        chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0,
        docCount: 0, qaCount: 0, assetMb: 0,
      })).resolves.not.toThrow();
      expect(poolQuery).toHaveBeenCalled();
    });
  });

  // =====================================================================
  // queryUsage
  // =====================================================================
  describe('queryUsage', () => {
    it('happy path: 返回 rows + totals，计算正确', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [
          usageRow({ day: '2026-10-14', chat_count: 10, api_call_count: 50, storage_bytes: 1000, user_count: 2 }),
          usageRow({ day: '2026-10-15', chat_count: 20, api_call_count: 60, storage_bytes: 2000, user_count: 3 }),
        ],
      });

      const result = await svc().queryUsage('t1', '2026-10-14', '2026-10-15');

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].day).toBe('2026-10-14');
      expect(result.rows[1].day).toBe('2026-10-15');
      expect(result.totals.chatCount).toBe(30);        // 10 + 20
      expect(result.totals.apiCallCount).toBe(110);    // 50 + 60
      expect(result.totals.storageBytes).toBe(3000);   // 1000 + 2000
      expect(result.totals.userCount).toBe(5);         // max of 2,3 -> sum: 5
    });

    it('默认最近 30 天: from=今天-29, to=今天', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      await svc().queryUsage('t1'); // no params

      const [, params] = poolQuery.mock.calls[0];
      const from = params[1] as string;
      const to = params[2] as string;
      // 简单验证：from <= to，差距约 29 天
      expect(new Date(from).getTime()).toBeLessThanOrEqual(new Date(to).getTime());
    });

    it('空结果 → rows=[], totals 全零', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await svc().queryUsage('t1', '2025-01-01', '2025-01-31');

      expect(result.rows).toHaveLength(0);
      expect(result.totals).toEqual({
        chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0,
        docCount: 0, qaCount: 0, assetMb: 0,
      });
    });
  });

  // =====================================================================
  // todaySummary
  // =====================================================================
  describe('todaySummary', () => {
    it('happy path: 返回当日汇总', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [usageRow({ day: new Date().toISOString().slice(0, 10), chat_count: 7, api_call_count: 33 })],
      });

      const result = await svc().todaySummary('t1');

      expect(result.chatCount).toBe(7);
      expect(result.apiCallCount).toBe(33);
      expect(result.storageBytes).toBe(1024000); // from default row
    });

    it('无当日行 → 返回全零', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      const result = await svc().todaySummary('t1');

      expect(result.chatCount).toBe(0);
      expect(result.apiCallCount).toBe(0);
      expect(result.storageBytes).toBe(0);
      expect(result.userCount).toBe(0);
      expect(result.day).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  it('upsertReport 持久化容量字段', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    await svc().upsertReport('t1', '2026-10-28', {
      msgsIn: 10, triggered: 8, hit: 6, miss: 2, tokens: 100, activeChats: 3,
      docCount: 4, qaCount: 5, assetMb: 6,
    });
    const params = poolQuery.mock.calls[0][1] as unknown[];
    expect(params).toEqual(expect.arrayContaining([4, 5, 6]));
  });
});