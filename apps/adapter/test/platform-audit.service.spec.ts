/**
 * PlatformAuditService 单元测试
 *
 * 覆盖：
 *   - append 首条 prev_hash=""，链式哈希正确
 *   - 多条 append 形成链（每行 prev_hash = 前一条 hash）
 *   - 并发安全（FOR UPDATE 取最后一行）
 *   - verifyChain 检测篡改（改 hash / prev_hash 断链 / 删中间行）
 *   - verifyChain 在空表时 valid=true
 *   - list 过滤（tenantId / action / from / to / pagination）
 *   - append 失败不回抛（返回 null），业务不中断
 *
 * pg Pool / client 全部 mock，不依赖真实 DB。
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (sql: string, params?: unknown[]) =>
      (globalThis as any).__pa.poolQuery(sql, params),
    connect: async () => (globalThis as any).__pa.client,
  })),
}));

import { PlatformAuditService, computeHash } from '../src/platform/platform-audit.service.js';

function svc() {
  return new PlatformAuditService({} as any);
}

interface CapturedCall {
  sql: string;
  params?: unknown[];
}

interface Harness {
  calls: CapturedCall[];
  client: { query: jest.Mock; release: jest.Mock };
  lastHash: () => string | null;
}

/**
 * 构造一个假 pg client：按 SQL 关键字应答，并把每次调用的 sql/params 记录下来。
 * lastHash 模拟「表中最后一行 hash」，供 FOR UPDATE 查询返回。
 */
function makeHarness(opts: { lastHash?: string | null; failOn?: 'BEGIN' | 'INSERT' } = {}): Harness {
  const calls: CapturedCall[] = [];
  let lastHash = opts.lastHash ?? null;

  const client = {
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN') {
        if (opts.failOn === 'BEGIN') throw new Error('DB connection lost');
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/FOR UPDATE/i.test(sql)) {
        return { rows: lastHash === null ? [] : [{ hash: lastHash }] };
      }
      if (/INSERT INTO platform_audit_log/i.test(sql)) {
        if (opts.failOn === 'INSERT') throw new Error('constraint violation');
        const p = params as unknown[];
        lastHash = String(p[5]); // hash 是第 6 个参数
        return {
          rows: [{ id: 'gen-1', hash: p[5], prev_hash: p[4], created_at: p[6] }],
        };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };

  return { calls, client, lastHash: () => lastHash };
}

function useHarness(h: Harness) {
  (globalThis as any).__pa = { poolQuery, client: h.client };
}

function insertParams(h: Harness): any[] {
  const call = h.calls.find((c) => /INSERT INTO platform_audit_log/i.test(c.sql));
  return (call?.params ?? []) as any[];
}

function auditRow(over: Record<string, unknown> = {}) {
  return {
    id: 'audit-0001',
    tenant_id: 't1',
    action: 'tenant.create',
    actor: 'op-1',
    payload: { name: '客户A' },
    prev_hash: '',
    hash: computeHash({
      prev_hash: '',
      action: 'tenant.create',
      actor: 'op-1',
      tenant_id: 't1',
      payload: { name: '客户A' },
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/** 构造链上的一行（hash 自洽） */
function chainRow(id: string, prevHash: string, action: string, createdAt: string) {
  const hash = computeHash({
    prev_hash: prevHash,
    action,
    actor: 'op-1',
    tenant_id: 't1',
    payload: {},
    created_at: createdAt,
  });
  return {
    id,
    tenant_id: 't1',
    action,
    actor: 'op-1',
    payload: {},
    prev_hash: prevHash,
    hash,
    created_at: createdAt,
  };
}

// ---- append 基本路径 ----

describe('PlatformAuditService.append', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
    useHarness(h);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('首条 prev_hash=""，链起始', async () => {
    const hash = await svc().append({
      action: 'tenant.create',
      actor: 'op-1',
      tenantId: 't1',
      payload: { name: '客户A' },
    });
    expect(hash).toBeDefined();
    expect(hash!.length).toBe(64); // sha256 hex

    const p = insertParams(h);
    expect(p[4]).toBe(''); // prev_hash 为空串
    expect(p[5]).toBe(hash);
    // hash 必须可由规范字段重算
    expect(hash).toBe(
      computeHash({
        prev_hash: '',
        action: 'tenant.create',
        actor: 'op-1',
        tenant_id: 't1',
        payload: { name: '客户A' },
        created_at: String(p[6]),
      }),
    );
  });

  it('使用 FOR UPDATE 读最后一行取 prev_hash', async () => {
    h = makeHarness({ lastHash: 'hash1' });
    useHarness(h);
    await svc().append({ action: 'tenant.provision', actor: 'op-1', tenantId: 't1', payload: {} });
    const lockCall = h.calls.find((c) => /FOR UPDATE/i.test(c.sql));
    expect(lockCall).toBeDefined();
    expect(insertParams(h)[4]).toBe('hash1');
  });

  it('第二条 prev_hash = 第一条的 hash', async () => {
    const h1 = makeHarness();
    useHarness(h1);
    const hash1 = await svc().append({
      action: 'tenant.create',
      actor: 'op-1',
      tenantId: 't1',
      payload: {},
    });

    const h2 = makeHarness({ lastHash: hash1 });
    useHarness(h2);
    const hash2 = await svc().append({
      action: 'tenant.provision',
      actor: 'op-1',
      tenantId: 't1',
      payload: {},
    });

    expect(insertParams(h2)[4]).toBe(hash1);
    expect(hash2).not.toBe(hash1);
    expect(hash2!.length).toBe(64);
  });

  it('多次 append 形成完整链', async () => {
    const actions = ['tenant.create', 'tenant.provision', 'tenant.suspend', 'tenant.resume'];
    const hashes: string[] = [];
    let lastHash: string | null = null;

    for (const action of actions) {
      const hh = makeHarness({ lastHash });
      useHarness(hh);
      const hash = await svc().append({
        action: action as any,
        actor: 'system',
        tenantId: null,
        payload: { step: action },
      });
      // prev_hash 指向上一条
      expect(insertParams(hh)[4]).toBe(lastHash ?? '');
      hashes.push(hash!);
      lastHash = hash;
    }

    // 链上每条 hash 都不同，且长度合法
    expect(new Set(hashes).size).toBe(actions.length);
    for (const hash of hashes) expect(hash.length).toBe(64);
  });

  it('事务失败 → rollback，返回 null，不回抛', async () => {
    const hh = makeHarness({ failOn: 'BEGIN' });
    useHarness(hh);
    const hash = await svc().append({
      action: 'tenant.create',
      actor: 'op-1',
      tenantId: 't1',
      payload: {},
    });
    expect(hash).toBeNull();
    expect(hh.client.release).toHaveBeenCalled();
  });

  it('INSERT 失败 → rollback，返回 null，不回抛', async () => {
    const hh = makeHarness({ failOn: 'INSERT' });
    useHarness(hh);
    const hash = await svc().append({
      action: 'tenant.create',
      actor: 'op-1',
      tenantId: 't1',
      payload: {},
    });
    expect(hash).toBeNull();
    expect(hh.calls.some((c) => c.sql === 'ROLLBACK')).toBe(true);
  });
});

// ---- verifyChain ----

describe('PlatformAuditService.verifyChain', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    (globalThis as any).__pa = { poolQuery, client: makeHarness().client };
  });

  it('空表 → valid=true, entries=0', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(0);
    expect(result.brokenAtId).toBeUndefined();
  });

  it('单条链 → valid=true', async () => {
    const row = auditRow();
    poolQuery.mockResolvedValueOnce({ rows: [row] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(1);
  });

  it('两行自洽链 → valid=true', async () => {
    const r1 = chainRow('a1', '', 'tenant.create', '2026-01-01T00:00:00.000Z');
    const r2 = chainRow('a2', r1.hash, 'tenant.suspend', '2026-01-01T00:01:00.000Z');
    poolQuery.mockResolvedValueOnce({ rows: [r1, r2] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(true);
    expect(result.entries).toBe(2);
  });

  it('篡改 hash → valid=false, brokenAtId', async () => {
    const tampered = auditRow();
    tampered.hash = '0000000000000000000000000000000000000000000000000000000000000000';

    poolQuery.mockResolvedValueOnce({ rows: [tampered] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(tampered.id);
  });

  it('篡改 payload（hash 不变）→ valid=false', async () => {
    const row = auditRow();
    row.payload = { name: '被篡改' };

    poolQuery.mockResolvedValueOnce({ rows: [row] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe(row.id);
  });

  it('删中间行 → prev_hash 断链', async () => {
    const r1 = chainRow('a1', '', 'tenant.create', '2026-01-01T00:00:00.000Z');
    // 原本 r2.prev_hash = r1.hash；中间行被删后 r2.prev_hash 仍指向 r1，链应断在 r2
    const r2 = chainRow('a2', r1.hash, 'tenant.suspend', '2026-01-01T00:01:00.000Z');
    r2.prev_hash = '';

    poolQuery.mockResolvedValueOnce({ rows: [r1, r2] });
    const result = await svc().verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAtId).toBe('a2');
  });
});

// ---- list ----

describe('PlatformAuditService.list', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    (globalThis as any).__pa = { poolQuery, client: makeHarness().client };
  });

  it('默认分页：limit=50, offset=0', async () => {
    const row = auditRow({ id: 'a1', action: 'tenant.create' });
    poolQuery.mockResolvedValueOnce({ rows: [row] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] });
    const result = await svc().list();
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
  });

  it('过滤 tenant_id', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    await svc().list({ tenantId: 't1' });
    // list 依次发起数据查询与计数查询，第 2 次为 count 查询
    const countSql = (poolQuery.mock.calls[1] as [string, ...any[]])[0];
    expect(countSql).toContain('tenant_id = $1');
    const countParams = (poolQuery.mock.calls[1] as [string, ...any[]])[1] as unknown[];
    expect(countParams).toEqual(['t1']);
  });

  it('过滤 action', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    await svc().list({ action: 'tenant.provision' });
    const countSql = (poolQuery.mock.calls[1] as [string, ...any[]])[0];
    expect(countSql).toContain('action = $1');
  });

  it('时间范围过滤 from/to', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    await svc().list({ from: '2026-10-01', to: '2026-10-07' });
    const countSql = (poolQuery.mock.calls[1] as [string, ...any[]])[0];
    expect(countSql).toContain('created_at >= $1');
    expect(countSql).toContain('created_at <= $2');
  });

  it('limit clamp: max 200', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    const result = await svc().list({ limit: 999 });
    expect(result.limit).toBe(200);
  });

  it('offset 负值归零', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });
    const result = await svc().list({ offset: -5 });
    expect(result.offset).toBe(0);
  });

  it('分页数据正确返回', async () => {
    const rows = [
      auditRow({ id: 'a1', action: 'tenant.create' }),
      auditRow({ id: 'a2', action: 'tenant.provision' }),
    ];
    poolQuery.mockResolvedValueOnce({ rows });
    poolQuery.mockResolvedValueOnce({ rows: [{ n: 2 }] });
    const result = await svc().list({ limit: 10, offset: 0 });
    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
    // 行字段 camelCase 化，且 hash 字段始终存在
    expect(result.rows[0].prevHash).toBeDefined();
    expect(result.rows[0].hash).toBeDefined();
    expect(result.rows[0].tenantId).toBe('t1');
  });
});
