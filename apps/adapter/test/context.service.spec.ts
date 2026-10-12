/**
 * ContextService 单元测试
 * 覆盖：5 轮截断（10 条消息）/TTL/multi 写入/读取 fail-open/清空
 */
import { resetRedis, mockRedisInstance } from './__setup__/redis.mock.js';
import { setConfig } from './__setup__/test-helpers.js';
import { ContextService } from '../src/context/context.service.js';

beforeAll(() => setConfig());

describe('ContextService', () => {
  beforeEach(() => resetRedis());

  it('append 5 轮后 rounds slice 到 10 条', async () => {
    let lastSetValue: string = '';
    // 模拟 Redis 有状态：每次 get 返回上一次 set 的内容（实现 append 依赖 get 的结果）
    let stored: string = '[]';
    mockRedisInstance.get.mockImplementation(() => Promise.resolve(stored));
    mockRedisInstance.multi.mockReturnValue({
      set: function (this: any, _k: string, v: string, ..._a: any[]) { lastSetValue = v; stored = v; return this; },
      expire: function (this: any, ..._a: any[]) { return this; },
      exec: jest.fn().mockResolvedValue([]),
    });
    const svc = new ContextService({} as any);
    for (let i = 0; i < 5; i++) {
      await svc.append('chat-x', 'user-a', { question: `q${i}`, answer: `a${i}` });
    }
    const rounds = JSON.parse(lastSetValue);
    expect(rounds.length).toBeLessThanOrEqual(10);
    expect(rounds.length).toBe(10); // 5 rounds * 2 messages
  });

  it('TTL 为 600 秒（默认）', async () => {
    let capturedEx: string = '';
    let capturedTtl: number = 0;
    mockRedisInstance.get.mockResolvedValue(null);
    mockRedisInstance.multi.mockReturnValue({
      set: function (this: any, _k: string, _v: string, ex: string, ttl: number, ..._a: any[]) { capturedEx = ex; capturedTtl = ttl; return this; },
      expire: function (this: any, ..._a: any[]) { return this; },
      exec: jest.fn().mockResolvedValue([]),
    });
    const svc = new ContextService({} as any);
    await svc.append('chat-y', 'user-b', { question: 'hi', answer: 'hello' });
    expect(capturedEx).toBe('EX');
    expect(capturedTtl).toBe(600); // schema 默认值
  });

  it('get 返回空时 []', async () => {
    mockRedisInstance.get.mockResolvedValue(null);
    const svc = new ContextService({} as any);
    const hist = await svc.get('chat-z', 'user-c');
    expect(hist).toEqual([]);
  });

  it('get Redis 异常 fail-open → []', async () => {
    mockRedisInstance.get.mockRejectedValue(new Error('redis down'));
    const svc = new ContextService({} as any);
    expect(await svc.get('chat-w', 'user-d')).toEqual([]);
  });

  it('clear 调用 DEL', async () => {
    let delKey = '';
    mockRedisInstance.del.mockImplementation((k: string) => { delKey = k; return Promise.resolve(1); });
    const svc = new ContextService({} as any);
    await svc.clear('chat-e', 'user-e');
    expect(delKey).toBe('ctx:chat-e:user-e');
  });
});
