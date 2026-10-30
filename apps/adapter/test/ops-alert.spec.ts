/**
 * OpsAlertService：按 key 冷却、未配置关闭、发送失败容错
 */
import { describe, it, expect, jest } from '@jest/globals';
import { OpsAlertService } from '../src/common/ops-alert.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const setup = (cooldownMs = 60_000) => {
  let now = 1_000_000;
  const send = jest.fn(async (_c: string) => true);
  const svc = new OpsAlertService({ cooldownMs, now: () => now, send });
  return { svc, send, advance: (ms: number) => { now += ms; } };
};

describe('OpsAlertService', () => {
  afterEach(() => resetConfig());

  it('sends once per key inside the cooldown', async () => {
    const { svc, send, advance } = setup(60_000);
    await svc.alert('wecom-signature', 'a');
    advance(1_000);
    await svc.alert('wecom-signature', 'b');
    expect(send).toHaveBeenCalledTimes(1);

    advance(60_000);
    await svc.alert('wecom-signature', 'c');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses independent cooldowns per key', async () => {
    const { svc, send } = setup(60_000);
    await svc.alert('k1', 'a');
    await svc.alert('k2', 'b');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('contains send failures', async () => {
    const svc = new OpsAlertService({
      cooldownMs: 1_000,
      now: () => 0,
      send: async () => { throw new Error('webhook down'); },
    });
    await expect(svc.alert('k', 'x')).resolves.toBe(false);
  });

  it('is disabled when no webhook is configured', async () => {
    setConfig({ OPS_WEBHOOK_URL: '' });
    const svc = new OpsAlertService({ cooldownMs: 1_000, now: () => 0 });
    await expect(svc.alert('k', 'x')).resolves.toBe(false);
  });
});
