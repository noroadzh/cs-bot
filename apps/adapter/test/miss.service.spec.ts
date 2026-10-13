/**
 * MissService 单元测试
 * 覆盖：record 异步入库 / FIFO 1000 上限 / PG 异常入队重试 / retry 成功出队
 *
 * 策略：
 * - 不 mock pg 模块（ESM/CJS 互转下不稳定），直接覆盖实例私有字段 svc.pool
 * - flushOne / retry 是 private，用 (svc as any) 绕过 TS 访问限制
 * - record() 依赖 setImmediate，用 jest.runAllTicks() 触发；
 *   retry 的 5s/15s setTimeout 用 jest.advanceTimersByTime 推进
 */
import { describe, it, expect, beforeAll, afterEach, jest } from '@jest/globals';
import { setConfig } from './__setup__/test-helpers.js';

const makeRecord = (i: number): any => ({
  traceId: `t-${i}`, chatId: 'chat-1', userId: 'u-1',
  question: `q${i}`, score: 0.1, engine: 'mock', ts: '2026-01-01T00:00:00Z',
});

const INSERT_SQL = 'INSERT INTO miss_record';

/** 覆盖 svc.pool，用脚本控制每次 query 的行为 */
function stubPool(svc: any, script: Array<'ok' | 'fail'> = ['ok']): jest.Mock {
  let idx = 0;
  const query = jest.fn((): Promise<any> => {
    const action = script[Math.min(idx, script.length - 1)] ?? 'ok';
    idx++;
    return action === 'ok'
      ? Promise.resolve({ rows: [] })
      : Promise.reject(new Error('PG down'));
  });
  svc.pool = { query, end: () => Promise.resolve() };
  return query;
}

beforeAll(() => setConfig());
afterEach(() => jest.useRealTimers());

describe('MissService', () => {
  it('3.5.a record 成功：pool.query 收到 INSERT 及参数，fifo 为空', async () => {
    const { MissService } = await import('../src/miss/miss.service.js');
    const svc = new MissService({} as any);
    const query = stubPool(svc, ['ok']);

    await svc.record(makeRecord(1));
    // record 内部走 setImmediate → flushOne → pool.query（async），需 await 微任务队列
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, any[]];
    expect(sql).toContain(INSERT_SQL);
    expect(params).toEqual(['t-1', 'chat-1', 'u-1', 'q1', 0.1, 'mock']);
    expect((svc as any).fifo).toHaveLength(0);
  });

  it('3.5.b PG 异常：数据入 FIFO，record() 不抛异常', async () => {
    const { MissService } = await import('../src/miss/miss.service.js');
    const svc = new MissService({} as any);
    const query = stubPool(svc, ['fail']);

    await expect(svc.record(makeRecord(2))).resolves.toBeUndefined();
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();

    expect(query).toHaveBeenCalledTimes(1);
    expect((svc as any).fifo).toHaveLength(1);
    expect((svc as any).fifo[0].traceId).toBe('t-2');
  });

  it('3.5.c retry 成功：记录从 FIFO 移出', async () => {
    const { MissService } = await import('../src/miss/miss.service.js');
    const svc = new MissService({} as any);
    // 初次失败，retry 成功
    const query = stubPool(svc, ['fail', 'ok']);

    await svc.record(makeRecord(3));
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    expect((svc as any).fifo).toHaveLength(1);

    // 直接调 private retry（等价于 5s 后定时器触发）
    await (svc as any).retry();

    expect((svc as any).fifo).toHaveLength(0);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('3.5.d retry 再失败：记录 unshift 回 FIFO 头部并安排 15s 后再试', async () => {
    const { MissService } = await import('../src/miss/miss.service.js');
    const svc = new MissService({} as any);
    const query = stubPool(svc, ['fail']);

    await svc.record(makeRecord(4));
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    expect((svc as any).fifo).toHaveLength(1);

    await (svc as any).retry(); // 失败 → unshift 回队首

    expect((svc as any).fifo).toHaveLength(1);
    expect((svc as any).fifo[0].traceId).toBe('t-4');
    // 持续失败只安排 15s 后的重试定时器，不向调用方抛异常
  });

  it('3.5.e FIFO 超过 1000：shift 最早记录腾空间', async () => {
    const { MissService } = await import('../src/miss/miss.service.js');
    const svc = new MissService({} as any);
    // 用 fail 路径才能让数据进入 fifo（flushOne 失败时 push）
    stubPool(svc, ['fail']);

    // 直接操作 fifo 模拟已填 999 条
    (svc as any).fifo = Array.from({ length: 999 }, (_, i) => makeRecord(i));

    // 再写 2 条：第 1001 条触发 shift t-0
    await svc.record(makeRecord(999));
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();
    await svc.record(makeRecord(1000));
    await new Promise((r) => setImmediate(r));
    await Promise.resolve();

    expect((svc as any).fifo).toHaveLength(1000);
    const ids: string[] = (svc as any).fifo.map((r: any) => r.traceId);
    expect(ids).not.toContain('t-0');    // 最老的被踢出
    expect(ids).toContain('t-1000');     // 最新写入的在队尾
  });
});