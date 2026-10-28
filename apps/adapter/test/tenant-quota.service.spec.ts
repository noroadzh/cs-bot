/**
 * TenantQuotaService 单元测试
 *
 * 覆盖：
 *   - setQuota: PATCH 子集校验（非正整数/空 patch → 400）、租户不存在 → 404、
 *                写审计 tenant.quota-set（带 before/after 快照）
 *   - getQuota / ensureDefaultQuota
 *   - consume: 原子消耗、租户不存在 → 404、超限 → 429、delta 非法 → 400
 *
 * pg Pool 全部 mock，不依赖真实 DB。
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const poolQuery = jest.fn() as jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>
>;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
  })),
}));

import {
  TenantQuotaService,
  DEFAULT_QUOTA,
} from '../src/platform/tenant-quota.service.js';

const auditAppend = jest.fn(async () => 'hash-1');

function svc() {
  return new TenantQuotaService({ append: auditAppend } as any, {} as any);
}

function quotaRow(over: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    tenant_id: 't1',
    max_chats: 5,
    max_storage_mb: 2048,
    max_api_calls: 5000,
    max_users: 2,
    max_llm_tokens_per_month: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

describe('TenantQuotaService', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    auditAppend.mockClear();
  });

  // ---- setQuota ----

  describe('setQuota', () => {
    it('空 patch → 400 TENANT_QUOTA_INVALID', async () => {

      await expect(svc().setQuota('t1', {})).rejects.toMatchObject({
        response: { errCode: 'TENANT_QUOTA_INVALID' },
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('非正整数 → 400 且标出字段', async () => {
      await expect(svc().setQuota('t1', { maxChats: 0 })).rejects.toMatchObject({
        response: { errCode: 'TENANT_QUOTA_INVALID', field: 'maxChats' },
      });
      await expect(svc().setQuota('t1', { maxUsers: 1.5 })).rejects.toMatchObject({
        response: { errCode: 'TENANT_QUOTA_INVALID', field: 'maxUsers' },
      });
    });

    it('租户无配额行 → 404 TENANT_NOT_FOUND', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] }); // getQuota → null
      await expect(svc().setQuota('t1', { maxChats: 10 })).rejects.toMatchObject({
        response: { errCode: 'TENANT_NOT_FOUND' },
      });
    });

    it('更新成功并返回映射后的配额', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] }); // getQuota (before)
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow({ max_chats: 10 })] }); // UPDATE RETURNING

      const result = await svc().setQuota('t1', { maxChats: 10 });

      expect(result.maxChats).toBe(10);
      expect(result.tenantId).toBe('t1');
    });

    it('UPDATE 影响 0 行 → 404', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [] });
      await expect(svc().setQuota('t1', { maxChats: 10 })).rejects.toMatchObject({
        response: { errCode: 'TENANT_NOT_FOUND' },
      });
    });

    it('写审计：action=tenant.quota-set，payload 含 before/after 全维度', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow({ max_chats: 10 })] });

      await svc().setQuota('t1', { maxChats: 10 }, 'op-1');

      expect(auditAppend).toHaveBeenCalledTimes(1);
      const arg = (auditAppend as any).mock.calls[0][0] as any;
      expect(arg.action).toBe('tenant.quota-set');
      expect(arg.actor).toBe('op-1');
      expect(arg.tenantId).toBe('t1');
      expect(arg.payload.before).toEqual({
        maxChats: 5,
        maxStorageMb: 2048,
        maxApiCalls: 5000,
        maxUsers: 2,
        maxLlmTokensPerMonth: 0,
      });
      expect(arg.payload.after).toEqual({
        maxChats: 10,
        maxStorageMb: 2048,
        maxApiCalls: 5000,
        maxUsers: 2,
        maxLlmTokensPerMonth: 0,
      });
    });

    it('只更新 PATCH 指定的列', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow({ max_users: 9 })] });

      await svc().setQuota('t1', { maxUsers: 9 });

      const sql = poolQuery.mock.calls[1][0] as string;
      expect(sql).toContain('max_users = $2');
      expect(sql).not.toContain('max_chats = $');
    });

    it('setQuota 后向配额下发通道推送新配额', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow({ max_chats: 10 })] });
      const push = jest.fn(async (_id: string, _q: any) => undefined);
      const s = svc();
      s.setQuotaPusher({ push });
      await s.setQuota('t1', { maxChats: 10 });
      expect(push).toHaveBeenCalledTimes(1);
      expect((push as any).mock.calls[0][1].maxChats).toBe(10);
    });
  });

  // ---- getQuota / ensureDefaultQuota ----

    it('容量维度 maxDocs/maxQa/maxAssetMb 可更新', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [quotaRow()] })
        .mockResolvedValueOnce({ rows: [quotaRow({ max_docs: 2000, max_qa: 5000, max_asset_mb: 4096 })] });
      const out = await svc().setQuota('t1', { maxDocs: 2000, maxQa: 5000, maxAssetMb: 4096 });
      expect(out.maxDocs).toBe(2000);
      expect(out.maxQa).toBe(5000);
      expect(out.maxAssetMb).toBe(4096);
    });

  describe('getQuota', () => {
    it('有行 → 映射返回', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      const result = await svc().getQuota('t1');
      expect(result?.maxChats).toBe(5);
      expect(result?.maxApiCalls).toBe(5000);
    });

    it('无行 → null', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      expect(await svc().getQuota('t1')).toBeNull();
    });
  });

  describe('ensureDefaultQuota', () => {
    it('用 DEFAULT_QUOTA 建行（ON CONFLICT 幂等）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [quotaRow()] });
      const result = await svc().ensureDefaultQuota('t1');

      const sql = poolQuery.mock.calls[0][0] as string;
      expect(sql).toContain('INSERT INTO tenant_quota');
      expect(sql).toContain('ON CONFLICT (tenant_id) DO UPDATE');
      const params = poolQuery.mock.calls[0][1] as unknown[];
      expect(params).toEqual([
        't1',
        DEFAULT_QUOTA.maxChats,
        DEFAULT_QUOTA.maxStorageMb,
        DEFAULT_QUOTA.maxApiCalls,
        DEFAULT_QUOTA.maxUsers,
        DEFAULT_QUOTA.maxLlmTokensPerMonth,
      ]);
      expect(result.tenantId).toBe('t1');
    });
  });

  // ---- consume ----

  describe('consume', () => {
    it('租户不存在 → 404 TENANT_NOT_FOUND', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] }); // SELECT id FROM tenant
      await expect(
        svc().consume({ tenantId: 'missing', kind: 'chat', delta: 1 }),
      ).rejects.toMatchObject({
        response: { errCode: 'TENANT_NOT_FOUND' },
      });
    });

    it('delta 非法（负数/非整数）→ 400', async () => {
      await expect(
        svc().consume({ tenantId: 't1', kind: 'chat', delta: -1 }),
      ).rejects.toMatchObject({ response: { errCode: 'TENANT_QUOTA_INVALID' } });
      await expect(
        svc().consume({ tenantId: 't1', kind: 'chat', delta: 1.5 }),
      ).rejects.toMatchObject({ response: { errCode: 'TENANT_QUOTA_INVALID' } });
    });

    it('额度充足 → allowed=true', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] }); // tenant 存在
      poolQuery.mockResolvedValueOnce({ rows: [] }); // 确保今日行
      poolQuery.mockResolvedValueOnce({ rows: [{ used: 3 }] }); // UPDATE RETURNING
      poolQuery.mockResolvedValueOnce({ rows: [{ v: 5 }] }); // readQuotaLimit

      const result = await svc().consume({ tenantId: 't1', kind: 'chat', delta: 3 });

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(3);
      expect(result.limit).toBe(5);
      expect(result.limitColumn).toBe('max_chats');
    });

    it('超限 → 429 TENANT_QUOTA_EXCEEDED', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] }); // tenant 存在
      poolQuery.mockResolvedValueOnce({ rows: [] }); // 确保今日行
      poolQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE 影响 0 行
      poolQuery.mockResolvedValueOnce({ rows: [{ v: 5 }] }); // readQuotaLimit
      poolQuery.mockResolvedValueOnce({ rows: [{ v: 5 }] }); // readUsageUsed

      await expect(
        svc().consume({ tenantId: 't1', kind: 'chat', delta: 1 }),
      ).rejects.toMatchObject({
        response: {
          errCode: 'TENANT_QUOTA_EXCEEDED',
          limitColumn: 'max_chats',
          limit: 5,
          used: 5,
        },
      });
    });

    it('各 kind 映射到正确的 count/limit 列', async () => {
      const cases: [('chat' | 'api_call' | 'storage' | 'user'), string, string][] = [
        ['chat', 'chat_count', 'max_chats'],
        ['api_call', 'api_call_count', 'max_api_calls'],
        ['storage', 'storage_bytes', 'max_storage_mb'],
        ['user', 'user_count', 'max_users'],
      ];

      for (const [kind, countCol, limitCol] of cases) {
        poolQuery.mockReset();
        poolQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] });
        poolQuery.mockResolvedValueOnce({ rows: [] });
        poolQuery.mockResolvedValueOnce({ rows: [{ used: 1 }] });
        poolQuery.mockResolvedValueOnce({ rows: [{ v: 10 }] });

        const result = await svc().consume({ tenantId: 't1', kind, delta: 1 });

        const updateSql = poolQuery.mock.calls[2][0] as string;
        expect(updateSql).toContain(countCol);
        expect(updateSql).toContain(limitCol);
        expect(result.limitColumn).toBe(limitCol);
      }
    });
  });
});