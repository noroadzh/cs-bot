/**
 * RateLimiterService 单元测试
 * 覆盖：群限超/用户限超/未超限/Redis 异常 fail-open
 * 走 INCR+EXPIRE 路径（mock 让 script LOAD 失败）
 */
import { resetRedis, mockRedisInstance } from './__setup__/redis.mock.js';
import { setConfig } from './__setup__/test-helpers.js';
import { RateLimiterService } from '../src/routing/rate-limiter.service.js';

beforeAll(() => setConfig());

describe('RateLimiterService', () => {
  beforeEach(() => {
    resetRedis();
    // 走 fallback INCR 路径
    mockRedisInstance.script.mockRejectedValue(new Error('script disabled'));
  });

  it('正常请求：allowed=true，scope undefined', async () => {
    mockRedisInstance.incr.mockResolvedValue(1);
    const svc = new RateLimiterService({} as any);
    const r = await svc.check('chat-1', 'user-1');
    expect(r.allowed).toBe(true);
    expect(r.scope).toBeUndefined();
  });

  it('用户限超：allowed=false, scope=user', async () => {
    // user key incr: 1st call 1, then second test resets; here: user incr=6 (>5), group incr=1
    mockRedisInstance.incr
      .mockResolvedValueOnce(6)  // user
      .mockResolvedValueOnce(1); // group
    const svc = new RateLimiterService({} as any);
    const r = await svc.check('chat-1', 'user-1');
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe('user');
  });

  it('群限超：allowed=false, scope=group', async () => {
    // user ok (1), group over (21 > 20)
    mockRedisInstance.incr
      .mockResolvedValueOnce(1)   // user
      .mockResolvedValueOnce(21); // group
    const svc = new RateLimiterService({} as any);
    const r = await svc.check('chat-1', 'user-1');
    expect(r.allowed).toBe(false);
    expect(r.scope).toBe('group');
  });

  it('Redis 异常：fail-open → allowed=true', async () => {
    mockRedisInstance.incr.mockRejectedValue(new Error('redis down'));
    const svc = new RateLimiterService({} as any);
    const r = await svc.check('chat-1', 'user-1');
    expect(r.allowed).toBe(true);
  });

  it('shouldHint：Redis 失败时放行提示（true）', async () => {
    mockRedisInstance.set.mockRejectedValue(new Error('redis down'));
    const svc = new RateLimiterService({} as any);
    await expect(svc.shouldHint('chat-1')).resolves.toBe(true);
  });

  it('shouldHint：SET NX 成功才提示', async () => {
    mockRedisInstance.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const svc = new RateLimiterService({} as any);
    await expect(svc.shouldHint('chat-1')).resolves.toBe(true);
    await expect(svc.shouldHint('chat-1')).resolves.toBe(false);
  });
});
