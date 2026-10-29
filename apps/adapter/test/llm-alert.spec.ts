/**
 * LLM 双通道失败告警：阈值触发、冷却节流、成功清零、发送失败容错
 */
import { describe, it, expect, jest } from '@jest/globals';
import { LlmAlertService } from '../src/qa/llm-alert.service.js';

const setup = (opts: { threshold?: number; windowMs?: number; cooldownMs?: number } = {}) => {
  let now = 1_000_000;
  const send = jest.fn(async (_content: string) => true);
  const svc = new LlmAlertService({
    threshold: opts.threshold ?? 3,
    windowMs: opts.windowMs ?? 60_000,
    cooldownMs: opts.cooldownMs ?? 300_000,
    now: () => now,
    send,
  });
  return { svc, send, advance: (ms: number) => { now += ms; } };
};

describe('LlmAlertService', () => {
  it('does not alert below the threshold', async () => {
    const { svc, send } = setup({ threshold: 3 });
    await svc.recordFailure('e1');
    await svc.recordFailure('e2');
    expect(send).not.toHaveBeenCalled();
  });

  it('alerts once when the threshold is reached', async () => {
    const { svc, send } = setup({ threshold: 3 });
    await svc.recordFailure('e1');
    await svc.recordFailure('e2');
    await svc.recordFailure('e3');
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0])).toContain('双通道连续失败 3 次');
  });

  it('throttles repeated alerts inside the cooldown', async () => {
    const { svc, send, advance } = setup({ threshold: 1, cooldownMs: 300_000 });
    await svc.recordFailure('e1');
    advance(1_000);
    await svc.recordFailure('e2');
    expect(send).toHaveBeenCalledTimes(1);

    advance(300_000);
    await svc.recordFailure('e3');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('clears the window after a success', async () => {
    const { svc, send } = setup({ threshold: 3 });
    await svc.recordFailure('e1');
    await svc.recordFailure('e2');
    svc.recordSuccess();
    expect(svc.failureCount).toBe(0);
    await svc.recordFailure('e3');
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps failures outside the window from counting', async () => {
    const { svc, send, advance } = setup({ threshold: 2, windowMs: 1_000 });
    await svc.recordFailure('e1');
    advance(2_000);
    await svc.recordFailure('e2');
    expect(send).not.toHaveBeenCalled();
  });

  it('contains send failures instead of throwing', async () => {
    let now = 0;
    const svc = new LlmAlertService({
      threshold: 1,
      now: () => now,
      send: async () => { throw new Error('webhook down'); },
    });
    await expect(svc.recordFailure('e1')).resolves.toBe(false);
  });
});
