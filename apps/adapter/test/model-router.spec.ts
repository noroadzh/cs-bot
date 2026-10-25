/**
 * 增项 D：ModelRouter 三档路由与降级
 */
import { describe, it, expect, jest } from '@jest/globals';
import { ModelRouter } from '../src/qa/model-router.js';

function cloudProvider(text = 'cloud-answer') {
  return { chat: jest.fn(async (_p: string) => text) };
}
function localProvider(text = 'local-answer') {
  return { chat: jest.fn(async (_p: string) => text) };
}
function failingProvider() {
  return {
    chat: jest.fn(async (_p: string): Promise<string> => {
      throw new Error('local down');
    }),
  };
}

describe('ModelRouter', () => {
  it('cloud：只调用云端', async () => {
    const cloud = cloudProvider();
    const local = localProvider();
    const r = new ModelRouter('cloud', local, cloud);
    const res = await r.chat('q');
    expect(res).toEqual({ text: 'cloud-answer', source: 'cloud' });
    expect(local.chat).not.toHaveBeenCalled();
  });

  it('local：只调用本地', async () => {
    const cloud = cloudProvider();
    const local = localProvider();
    const r = new ModelRouter('local', local, cloud);
    const res = await r.chat('q');
    expect(res).toEqual({ text: 'local-answer', source: 'local' });
    expect(cloud.chat).not.toHaveBeenCalled();
  });

  it('hybrid：本地优先', async () => {
    const cloud = cloudProvider();
    const local = localProvider();
    const r = new ModelRouter('hybrid', local, cloud);
    const res = await r.chat('q');
    expect(res.source).toBe('local');
    expect(cloud.chat).not.toHaveBeenCalled();
  });

  it('hybrid：本地失败切云并标记 failover', async () => {
    const cloud = cloudProvider();
    const r = new ModelRouter('hybrid', failingProvider(), cloud);
    const res = await r.chat('q');
    expect(res).toEqual({ text: 'cloud-answer', source: 'cloud', failover: true });
  });

  it('local：本地失败直接抛出（不出站）', async () => {
    const cloud = cloudProvider();
    const r = new ModelRouter('local', failingProvider(), cloud);
    await expect(r.chat('q')).rejects.toThrow('local down');
    expect(cloud.chat).not.toHaveBeenCalled();
  });

  it('local/hybrid 缺本地 provider 构造失败', () => {
    expect(() => new ModelRouter('local', null, cloudProvider() as any)).toThrow();
    expect(() => new ModelRouter('hybrid', null, cloudProvider() as any)).toThrow();
  });
});

describe('ModelRouter 熔断与计数', () => {
  it('连续失败达阈值触发熔断，冷却后恢复', async () => {
    let now = 0;
    const local = failingProvider();
    const cloud = cloudProvider();
    const r = new ModelRouter('hybrid', local, cloud, {
      failThreshold: 3,
      cooldownMs: 1000,
      now: () => now,
    });

    await r.chat('q');
    await r.chat('q');
    await r.chat('q');
    expect(r.getStats().circuitOpen).toBe(true);
    expect(r.getStats().failover).toBe(3);

    // 熔断期：hybrid 直接走云，不再尝试本地
    const callsBefore = local.chat.mock.calls.length;
    const res = await r.chat('q');
    expect(res.source).toBe('cloud');
    expect(local.chat.mock.calls.length).toBe(callsBefore);

    // 冷却后恢复
    now = 2000;
    expect(r.getStats().circuitOpen).toBe(false);
  });

  it('local 模式熔断期内直接失败，不出站', async () => {
    let now = 0;
    const local = failingProvider();
    const cloud = cloudProvider();
    const r = new ModelRouter('local', local, cloud, {
      failThreshold: 1,
      cooldownMs: 1000,
      now: () => now,
    });
    await expect(r.chat('q')).rejects.toThrow('local down');
    expect(r.getStats().circuitOpen).toBe(true);
    await expect(r.chat('q')).rejects.toThrow('circuit open');
    expect(cloud.chat).not.toHaveBeenCalled();
  });

  it('统计 local 成功与 cloud 计数', async () => {
    const local = localProvider();
    const cloud = cloudProvider();
    const r = new ModelRouter('hybrid', local, cloud);
    await r.chat('q');
    const s = r.getStats();
    expect(s.localSuccess).toBe(1);
    expect(s.cloudSuccess).toBe(0);
  });
});
