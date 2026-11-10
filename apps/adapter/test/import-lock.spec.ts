/**
 * ImportLock：单并发租约（R-8 / IMPORT_BUSY）
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import { ImportLock } from '../src/import/import-lock.js';

const poolQuery = jest.fn() as jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }>
>;

describe('ImportLock', () => {
  let lock: ImportLock;

  beforeEach(() => {
    poolQuery.mockReset();
    lock = new ImportLock({ query: poolQuery } as any);
  });

  afterEach(async () => {
    await lock.release('job-a').catch(() => undefined);
  });

  it('acquire 成功持有锁并启动心跳', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ job_id: 'job-a' }], rowCount: 1 });
    await expect(lock.acquire('job-a', 'parsing')).resolves.toBeUndefined();
    expect(poolQuery.mock.calls[0][0]).toMatch(/INSERT INTO import_lock/i);
    expect(poolQuery.mock.calls[0][1]).toEqual(['job-a', 'parsing']);
  });

  it('第二把锁冲突 → IMPORT_BUSY 409 且带 activeJobId', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ job_id: 'job-a' }] });

    let err: HttpException | undefined;
    try {
      await lock.acquire('job-b', 'parsing');
    } catch (e) {
      err = e as HttpException;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err!.getStatus()).toBe(409);
    expect(err!.getResponse()).toMatchObject({
      errCode: 'IMPORT_BUSY',
      activeJobId: 'job-a',
    });
  });

  it('release 后删除本 job 的锁', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ job_id: 'job-a' }], rowCount: 1 });
    await lock.acquire('job-a', 'pairing');
    poolQuery.mockClear();
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await lock.release('job-a');
    expect(poolQuery.mock.calls[0][0]).toMatch(/DELETE FROM import_lock/i);
    expect(poolQuery.mock.calls[0][1]).toEqual(['job-a']);
  });

  it('forceRelease 清锁并返回 released', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ job_id: 'job-stale' }], rowCount: 1 });
    await expect(lock.forceRelease()).resolves.toEqual({ released: true });
    poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(lock.forceRelease()).resolves.toEqual({ released: false });
  });

  it('resetOnBoot 清理残留锁', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ job_id: 'job-crash' }], rowCount: 1 });
    await expect(lock.resetOnBoot()).resolves.toBeUndefined();
    expect(poolQuery.mock.calls[0][0]).toMatch(/DELETE FROM import_lock/i);
  });
});
