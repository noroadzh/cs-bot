/**
 * Redis 故障时 dedup 进程内兜底
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const set = jest.fn<(key: string, ...args: any[]) => Promise<any>>();
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({ set })),
}));

beforeEach(() => set.mockReset());

describe('DedupService fallback', () => {
  it('Redis 抛错时同一 MsgId 第二次视为重复', async () => {
    set.mockRejectedValue(new Error('redis down'));
    const { DedupService } = await import('../src/routing/dedup.service.js');
    const svc = new DedupService({} as any);
    await expect(svc.isDuplicate('dup-x')).resolves.toBe(false);
    await expect(svc.isDuplicate('dup-x')).resolves.toBe(true);
  });

  it('内存表达到上限后清理过期项并继续去重', async () => {
    set.mockRejectedValue(new Error('redis down'));
    const { DedupService } = await import('../src/routing/dedup.service.js');
    const svc = new DedupService({} as any);
    // 填满上限（10k），并触发清理分支
    for (let i = 0; i < 10_050; i++) {
      await svc.isDuplicate(`bulk-${i}`);
    }
    await expect(svc.isDuplicate('bulk-10049')).resolves.toBe(true);
  });
});
