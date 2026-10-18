/**
 * LicenseRuntimeScheduler 单元测试（M9.3）
 *
 * 覆盖：
 *   - msUntil3am 时间计算（现在距次日 03:00 / 距今日 03:00）
 *   - tick 触发 revalidate + log
 *   - tick 在 mock 模式不发告警
 *   - tick 在 daysLeft ≤15 时发一次提醒
 *   - tick 同日二次进入不发二次告警
 *   - tick 在 license 已失效时也发告警（reason + 受限模式提示）
 *   - tick 抛异常不打断下次的调度
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { LicenseRuntimeScheduler, EXPIRY_WARN_DAYS } from '../src/license/license-runtime.scheduler.js';

function makeLicenseState(over: Partial<{ valid: boolean; reason: string; daysLeft: number; expiresAtMs: number; mock: boolean }> = {}) {
  return {
    valid: true,
    reason: 'valid',
    mock: false,
    fingerprint: 'fp',
    expiresAtMs: Date.now() + 30 * 86_400_000,
    daysLeft: 30,
    maxChats: 100,
    ...over,
  };
}

describe('LicenseRuntimeScheduler', () => {
  beforeEach(() => setConfig({ USE_MOCK_LICENSE: false, OPS_WEBHOOK_URL: 'https://example/hook' }));
  afterEach(() => {
    resetConfig();
    jest.useRealTimers();
  });

  it('msUntil3am：当前已是 03:00 之后 → 距次日 03:00', () => {
    const sched = new LicenseRuntimeScheduler({} as any, {} as any);
    const now = new Date('2026-01-15T05:00:00');
    const ms = sched.msUntil3am(now);
    // 05:00 → 次日 03:00 = 22h
    expect(ms).toBe(22 * 3_600_000);
  });

  it('msUntil3am：当前在 03:00 之前 → 距今日 03:00', () => {
    const sched = new LicenseRuntimeScheduler({} as any, {} as any);
    const now = new Date('2026-01-15T01:00:00');
    const ms = sched.msUntil3am(now);
    // 01:00 → 今日 03:00 = 2h
    expect(ms).toBe(2 * 3_600_000);
  });

  it('tick 调用 revalidate 并记 log；mock 模式不告警', async () => {
    setConfig({ USE_MOCK_LICENSE: true, OPS_WEBHOOK_URL: 'https://example/hook' });
    const revalidate = jest.fn(() => makeLicenseState({ mock: true, daysLeft: 30 }));
    const sendAlert = jest.fn(async () => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    expect(revalidate).toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('tick 在 daysLeft=10 时发告警，且带"剩余 N 天"信息', async () => {
    setConfig({ USE_MOCK_LICENSE: false, OPS_WEBHOOK_URL: 'https://example/hook' });
    const revalidate = jest.fn(() => makeLicenseState({ daysLeft: 10 }));
    const sendAlert = jest.fn(async (_detail: string) => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect((sendAlert.mock.calls[0]![0] as string)).toContain('剩余 10 天');
  });

  it('tick 在 daysLeft 恰好等于阈值（15）时告警', async () => {
    setConfig({ USE_MOCK_LICENSE: false });
    const revalidate = jest.fn(() => makeLicenseState({ daysLeft: EXPIRY_WARN_DAYS }));
    const sendAlert = jest.fn(async () => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('tick 同日二次进入不再告警（去重）', async () => {
    setConfig({ USE_MOCK_LICENSE: false });
    const revalidate = jest.fn(() => makeLicenseState({ daysLeft: 5 }));
    const sendAlert = jest.fn(async () => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    await sched.tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('tick 在 license 已失效时也告警（reason=expired + 提示受限模式）', async () => {
    setConfig({ USE_MOCK_LICENSE: false });
    const revalidate = jest.fn(() => makeLicenseState({ valid: false, reason: 'expired', daysLeft: -1, expiresAtMs: 0 }));
    const sendAlert = jest.fn(async (_detail: string) => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect((sendAlert.mock.calls[0]![0] as string)).toContain('授权已失效');
  });

  it('tick 在 daysLeft=30 时不告警', async () => {
    setConfig({ USE_MOCK_LICENSE: false });
    const revalidate = jest.fn(() => makeLicenseState({ daysLeft: 30 }));
    const sendAlert = jest.fn(async () => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await sched.tick();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('tick 抛异常时不会向上抛出（避免打断循环调度）', async () => {
    setConfig({ USE_MOCK_LICENSE: false });
    const revalidate = jest.fn(() => {
      throw new Error('boom');
    });
    const sendAlert = jest.fn(async () => undefined);
    const sched = new LicenseRuntimeScheduler({ revalidate } as any, { sendAlert } as any);
    await expect(sched.tick()).resolves.toBeUndefined();
    expect(sendAlert).not.toHaveBeenCalled();
  });
});
