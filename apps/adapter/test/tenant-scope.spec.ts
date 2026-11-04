import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { MissService } from '../src/miss/miss.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('MissService tenant_id isolation', () => {
  afterEach(() => resetConfig());

  it('写入带上当前 TENANT_ID，更新仅限本租户', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
      end: jest.fn(async () => undefined),
    };

    setConfig({ TENANT_ID: 'tenant-a', DATABASE_URL: 'postgres://x' });
    // 绕过构造器内 new Pool：直接挂上 mock
    const svc = Object.create(MissService.prototype) as MissService;
    (svc as any).pool = pool;
    (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
    (svc as any).fifo = [];

    await (svc as any).flushOne({
      traceId: 'tr',
      chatId: 'c',
      userId: 'u',
      question: 'q',
      score: 0.1,
      engine: 'fastgpt',
      ts: new Date().toISOString(),
    });

    expect(queries[0].sql).toContain('tenant_id');
    expect(queries[0].params[7]).toBe('tenant-a');

    await svc.updateStatus(9, 1);
    expect(queries[1].params).toEqual([9, 1, 'tenant-a']);

    setConfig({ TENANT_ID: 'tenant-b', DATABASE_URL: 'postgres://x' });
    await svc.updateStatus(9, 2);
    expect(queries[2].params).toEqual([9, 2, 'tenant-b']);
  });
});
