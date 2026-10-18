/**
 * LicenseGateService 单元测试（M9.2）
 *
 * 覆盖：
 *   - license invalid → 拦截（reason=license-invalid）+ webhook 告警一次
 *   - license valid + 群已激活 → 放行
 *   - license valid + 群未激活且未满 → 自动激活并放行
 *   - license valid + 群未激活且已满 → 拦截（reason=chat-limit）+ 超限告警
 *   - 同群同日超限告警只发一次（L1 Map 去重）
 *   - Redis SET NX 返回 null（已有实例发过）→ 不再发 webhook
 *   - Redis 异常 → 退化为 L1 去重，webhook 照发
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { resetRedis, mockRedisInstance } from './__setup__/redis.mock.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { LicenseGateService } from '../src/license/license-gate.service.js';

function makeLicenseState(valid = true) {
  return {
    valid,
    reason: valid ? 'valid' : 'expired',
    mock: false,
    fingerprint: 'fp',
    expiresAtMs: Date.now() + 86_400_000,
    daysLeft: 1,
    maxChats: 100,
  };
}

function makeDeps(over: { valid?: boolean; count?: number; maxChats?: number; ensureThrow?: Error } = {}) {
  const { valid = true, count = 0, maxChats = 100, ensureThrow } = over;
  const licenseService = {
    getState: () => makeLicenseState(valid),
  };
  const licensedChats = {
    getCount: () => count,
    has: (id: string) => id === 'chat-active',
    ensureChat: async (id: string) => {
      if (ensureThrow) throw ensureThrow;
      return id !== 'chat-full';
    },
  };
  const alertService = { sendAlert: jest.fn(async (_detail: string) => true) };
  const gate = new LicenseGateService(licenseService as any, licensedChats as any, alertService as any);
  return { gate, alertService };
}

describe('LicenseGateService.check', () => {
  beforeEach(() => {
    setConfig({ USE_MOCK_LICENSE: false });
    resetRedis();
  });
  afterEach(() => resetConfig());

  it('license invalid → 拦截 license-invalid；告警由 scheduler 每日承担，gate 不发', async () => {
    const { gate, alertService } = makeDeps({ valid: false });
    const d = await gate.check('chat-1', '');
    expect(d.allowed).toBe(false);
    if (!d.allowed && 'reason' in d) expect(d.reason).toBe('license-invalid');
    expect((alertService.sendAlert as any).mock.calls.length).toBe(0);
  });

  it('valid + 已激活群 → 放行', async () => {
    const { gate } = makeDeps({ count: 1 });
    const d = await gate.check('chat-active', '');
    expect(d).toEqual({ allowed: true });
  });

  it('valid + 未激活 + 未满 → 激活并放行', async () => {
    const { gate } = makeDeps({ count: 0 });
    const d = await gate.check('chat-new', '');
    expect(d).toEqual({ allowed: true });
  });

  it('valid + 未激活 + 已满 → 拦截 chat-limit + 超限告警', async () => {
    const { gate, alertService } = makeDeps({ count: 100 });
    const d = await gate.check('chat-full', '');
    expect(d.allowed).toBe(false);
    if (!d.allowed && 'reason' in d) expect(d.reason).toBe('chat-limit');
    expect((alertService.sendAlert as any).mock.calls.length).toBe(1);
    expect((alertService.sendAlert as any).mock.calls[0]![0] as string).toContain('chat-full');
  });

  it('同群同日超限告警只发一次（进程内去重）', async () => {
    const { gate, alertService } = makeDeps({ count: 100 });
    await gate.check('chat-full', '');
    await gate.check('chat-full', '');
    expect((alertService.sendAlert as any).mock.calls.length).toBe(1);
  });

  it('Redis SET NX 返回 null（别的实例已发过）→ 不发 webhook', async () => {
    mockRedisInstance.set.mockResolvedValue(null);
    const { gate, alertService } = makeDeps({ count: 100 });
    await gate.check('chat-full', '');
    expect((alertService.sendAlert as any).mock.calls.length).toBe(0);
  });

  it('Redis 异常 → 退化为进程内去重，webhook 照发', async () => {
    mockRedisInstance.set.mockRejectedValue(new Error('redis down'));
    const { gate, alertService } = makeDeps({ count: 100 });
    const d = await gate.check('chat-full', '');
    expect(d.allowed).toBe(false);
    expect((alertService.sendAlert as any).mock.calls.length).toBe(1);
  });
});
