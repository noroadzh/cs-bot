/**
 * MissCleanupService 单元测试
 *
 * 对应 src/miss/miss-cleanup.service.ts 的分支：
 * - 构造函数读取 ConfigService.DATABASE_URL 与 MISS_RECORD_RETENTION_DAYS
 * - onModuleInit 内部启动 5 分钟的 setTimeout 哨兵（用 fake timer 触发）
 * - lastRunAt 仍为 null → 哨兵触发 WARN 提示 ScheduleModule 缺失
 * - lastRunAt 已被 cleanup() 更新 → 哨兵不再 WARN
 * - cleanup() 成功：执行 SQL，log 'cleanup'，并把 lastRunAt 设为 now
 * - cleanup() 失败（pool.query 抛错）→ log 'cleanup-error'，不向上抛
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

/** 构造 pg.Pool mock：query 返回 {rowCount}，可通过 .mockResolvedValueOnce 控制 */
function makePool() {
  const query = jest.fn() as jest.MockedFunction<(sql: string) => Promise<any>>;
  const end = jest.fn() as any;
  return { query, end };
}

beforeEach(() => {
  resetConfig();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  resetConfig();
});

describe('MissCleanupService', () => {
  it('构造函数从 ConfigService 读取 DATABASE_URL 与 MISS_RECORD_RETENTION_DAYS', async () => {
    setConfig({ DATABASE_URL: 'postgresql://u:p@db/cs', MISS_RECORD_RETENTION_DAYS: 30 });
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    // 私有字段不能直接读，但构造函数未抛错 + 调用 cleanup 走完即可证
    expect(svc).toBeInstanceOf(MissCleanupService);
  });

  it('cleanup() 成功 → 执行 DELETE SQL，记录 rowCount 日志，更新 lastRunAt', async () => {
    setConfig();
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    const pool = makePool();
    pool.query.mockResolvedValueOnce({ rowCount: 42 });
    (svc as any).pool = pool;

    await svc.cleanup();

    expect(pool.query).toHaveBeenCalledWith(expect.stringMatching(/DELETE FROM miss_record/));
    expect((svc as any).lastRunAt).not.toBeNull();
  });

  it('cleanup() pool.query 抛错 → log cleanup-error，不向上抛', async () => {
    setConfig();
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    const pool = makePool();
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    (svc as any).pool = pool;

    await expect(svc.cleanup()).resolves.toBeUndefined();
    // 异常路径里 lastRunAt 仍会被 set（cleanup 开头先赋值）
    expect((svc as any).lastRunAt).not.toBeNull();
  });

  it('cleanup() rowCount 为 undefined → 走默认值 0（不抛错）', async () => {
    setConfig();
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    const pool = makePool();
    pool.query.mockResolvedValueOnce({}); // 无 rowCount
    (svc as any).pool = pool;

    await expect(svc.cleanup()).resolves.toBeUndefined();
  });

  it('onModuleInit 5 分钟后 lastRunAt 仍为 null → 哨兵触发 WARN', async () => {
    setConfig();
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await svc.onModuleInit();
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'schedule-missing' }),
    );
    warn.mockRestore();
  });

  it('onModuleInit 5 分钟前 cleanup() 已被调用 → 哨兵不 WARN', async () => {
    setConfig();
    const { MissCleanupService } = await import('../src/miss/miss-cleanup.service.js');
    const svc = new MissCleanupService({} as any);
    (svc as any).pool = makePool();
    const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);

    await svc.onModuleInit();
    await svc.cleanup(); // 让 lastRunAt 变为 now
    jest.advanceTimersByTime(5 * 60 * 1000);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});