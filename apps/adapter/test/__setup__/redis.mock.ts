/**
 * 共享 Redis mock——所有依赖 ioredis 的服务共用此桩
 * 不需要 docker/redis-server，在 Node.js 单进程内运行
 */
export const mockRedisInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  lpush: jest.fn(),
  ltrim: jest.fn(),
  lrange: jest.fn(),
  mget: jest.fn(),
  eval: jest.fn(),
  script: jest.fn(),
  multi: jest.fn().mockReturnValue({
    set: function (this: any, ...args: any[]) { return this; },
    expire: function (this: any, ...args: any[]) { return this; },
    exec: jest.fn().mockResolvedValue([]),
  }),
};

// 让 jest.doMock('ioredis') 统一返回这个 mock 实例
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => mockRedisInstance),
}));

export function resetRedis() {
  for (const k of Object.keys(mockRedisInstance) as (keyof typeof mockRedisInstance)[]) {
    if (typeof mockRedisInstance[k] === 'function') {
      (mockRedisInstance[k] as jest.Mock).mockReset();
    }
  }
  // 默认行为：get 返回 null，set/incr 返回 OK
  mockRedisInstance.get.mockResolvedValue(null);
  mockRedisInstance.set.mockResolvedValue('OK');
  mockRedisInstance.incr.mockResolvedValue(1);
  mockRedisInstance.del.mockResolvedValue(1);
  mockRedisInstance.lpush.mockResolvedValue(1);
  mockRedisInstance.ltrim.mockResolvedValue('OK');
  mockRedisInstance.lrange.mockResolvedValue([]);
  mockRedisInstance.eval.mockResolvedValue(null);
  mockRedisInstance.script.mockResolvedValue('sha1');
  mockRedisInstance.multi.mockReturnValue({
    set: function (this: any, ..._args: any[]) { return this; },
    expire: function (this: any, ..._args: any[]) { return this; },
    exec: jest.fn().mockResolvedValue([]),
  });
}
