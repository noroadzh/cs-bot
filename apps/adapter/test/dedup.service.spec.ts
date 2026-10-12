/**
 * DedupService 单元测试
 * 覆盖：首次/重复/空 MsgId/Redis 异常 fail-open
 */
import { resetRedis, mockRedisInstance } from './__setup__/redis.mock.js';
import { setConfig } from './__setup__/test-helpers.js';
import { DedupService } from '../src/routing/dedup.service.js';

beforeAll(() => setConfig());

describe('DedupService', () => {
  beforeEach(() => resetRedis());

  it('首次消息：返回 false（不重复）', async () => {
    mockRedisInstance.set.mockResolvedValue('OK');
    const svc = new DedupService({} as any);
    expect(await svc.isDuplicate('msg-001')).toBe(false);
  });

  it('重复消息：返回 true', async () => {
    // Redis SET EX NX：已存在则返回 null（由 mock 处理）
    mockRedisInstance.set.mockResolvedValue(null);
    const svc = new DedupService({} as any);
    expect(await svc.isDuplicate('msg-002')).toBe(true);
  });

  it('空 MsgId：直接返回 false，不查 Redis', async () => {
    const svc = new DedupService({} as any);
    expect(await svc.isDuplicate('')).toBe(false);
    expect(mockRedisInstance.set).not.toHaveBeenCalled();
  });

  it('Redis 异常：fail-open → 返回 false', async () => {
    mockRedisInstance.set.mockRejectedValue(new Error('redis down'));
    const svc = new DedupService({} as any);
    expect(await svc.isDuplicate('msg-003')).toBe(false);
  });
});
