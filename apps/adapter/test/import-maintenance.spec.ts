/**
 * 导入保留期清理 + 内存保护纯函数
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const readdir: any = jest.fn();
const stat: any = jest.fn();
const unlink: any = jest.fn();
const query: any = jest.fn();
jest.mock('node:fs', () => ({ promises: { readdir, stat, unlink } }));
jest.mock('pg', () => ({ Pool: jest.fn(() => ({ query, end: jest.fn(async () => undefined) })) }));

import { isMemoryHigh } from '../src/import/import-job.service.js';
import { ImportCleanupService } from '../src/import/import-cleanup.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

beforeEach(() => {
  setConfig();
  readdir.mockReset();
  stat.mockReset();
  unlink.mockReset();
  query.mockReset();
});

describe('isMemoryHigh', () => {
  it('超过 80% 才触发', () => {
    expect(isMemoryHigh(800 * 1024 * 1024, 1000)).toBe(false);
    expect(isMemoryHigh(801 * 1024 * 1024, 1000)).toBe(true);
  });
});

describe('ImportCleanupService', () => {
  it('删除 >30 天 review.xlsx 与 >180 天 item', async () => {
    const now = Date.now();
    readdir.mockResolvedValue([
      { name: 'job-old', isDirectory: () => true },
      { name: 'job-new', isDirectory: () => true },
      { name: 'loose.txt', isDirectory: () => false },
    ]);
    stat
      .mockResolvedValueOnce({ mtimeMs: now - 31 * 86_400_000 })
      .mockResolvedValueOnce({ mtimeMs: now - 1 * 86_400_000 });
    unlink.mockResolvedValue(undefined);
    query.mockResolvedValue({ rowCount: 3 });

    const svc = new ImportCleanupService({} as any);
    const r = await svc.cleanup(now);
    expect(r).toEqual({ reviewFiles: 1, items: 3 });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('180 days'));
    await svc.onModuleDestroy();
  });
});

afterAll(() => resetConfig());
