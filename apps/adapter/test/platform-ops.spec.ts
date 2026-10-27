/**
 * M11 运营：配额预警、订阅提醒通知、D10 上报、审计清理
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const axiosPost: any = jest.fn();
jest.mock('axios', () => ({ default: { post: axiosPost }, post: axiosPost }));

const pgQuery: any = jest.fn();
jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query: pgQuery, end: jest.fn(async () => undefined) })),
}));

import {
  isQuotaWarning,
  WebhookQuotaWarningNotifier,
} from '../src/platform/quota-warning.js';
import { computeFailRates } from '../src/platform/platform-monitor.js';
import { SubscriptionReminder, WebhookNotifier } from '../src/platform/subscription-reminder.js';
import { PlatformAuditService } from '../src/platform/platform-audit.service.js';
import {
  buildControlPlanePayload,
  pruneBuffer,
} from '../src/usage/usage-reporter.scheduler.js';
import type { UsageCounters } from '../src/usage/usage.service.js';

beforeEach(() => {
  axiosPost.mockReset().mockResolvedValue({ data: {} });
  pgQuery.mockReset();
});

describe('quota warning', () => {
  it('80% 边界', () => {
    expect(isQuotaWarning(79, 100)).toBe(false);
    expect(isQuotaWarning(80, 100)).toBe(true);
    expect(isQuotaWarning(100, 100)).toBe(true);
    expect(isQuotaWarning(101, 100)).toBe(false);
    expect(isQuotaWarning(1, 0)).toBe(false);
  });

  it('webhook 通知包含租户/维度；空 URL 不发送', async () => {
    await new WebhookQuotaWarningNotifier('https://ops.example/hook').warn('T-1', 'chat', 8, 10);
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(axiosPost.mock.calls[0][1])).toContain('T-1');
    axiosPost.mockClear();
    await new WebhookQuotaWarningNotifier('').warn('T-1', 'chat', 8, 10);
    expect(axiosPost).not.toHaveBeenCalled();
  });
});

describe('subscription notifier', () => {
  it('WebhookNotifier 发送 target/subject/body', async () => {
    await new WebhookNotifier('https://ops.example/hook').send('ops', 'T-30', '租户 A 剩余 30 天');
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(axiosPost.mock.calls[0][1])).toContain('T-30');
  });

  it('SubscriptionReminder 只对 30/15/7 天精确命中发送', async () => {
    const sent: string[] = [];
    const reminder = new SubscriptionReminder({
      send: async (_t, subject) => { sent.push(subject); },
    });
    const now = new Date('2026-10-27T00:00:00Z');
    const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
    const count = await reminder.dispatch(
      [
        { id: 'a', name: 'A', expiresAt: days(30) },
        { id: 'b', name: 'B', expiresAt: days(15) },
        { id: 'c', name: 'C', expiresAt: days(20) },
      ],
      now,
    );
    expect(count).toBe(2);
    expect(sent.length).toBe(4); // 每租户 tenant + ops
  });
});

describe('D10 usage report', () => {
  it('payload 仅计数并映射字段', () => {
    const counters = {
      messagesReceived: 10, messagesTriggered: 8, messagesAnswered: 6, messagesMissed: 2,
      tokensPrimary: 100, tokensFallback: 20,
    } as UsageCounters;
    const p = buildControlPlanePayload('T-1', counters, new Date('2026-10-27T10:00:00Z'));
    expect(p).toMatchObject({
      tenantId: 'T-1', date: '2026-10-27', msgsIn: 10, triggered: 8,
      hit: 6, miss: 2, tokens: 120, activeChats: 0,
    });
    expect(JSON.stringify(p)).not.toContain('question');
  });

  it('缓冲最多保留 7 天', () => {
    const now = Date.now();
    const kept = pruneBuffer([
      { payload: {}, ts: now - 8 * 86_400_000 },
      { payload: {}, ts: now - 6 * 86_400_000 },
    ], now);
    expect(kept).toHaveLength(1);
  });
});

describe('instance fail rates', () => {
  it('从 healthz usage 计算问答/LLM 失败率', () => {
    expect(computeFailRates({ messagesReceived: 100, messagesMissed: 5, llmFailures: 2 })).toEqual({
      qaFailRate: 0.05,
      llmFailRate: 0.02,
    });
    expect(computeFailRates({ messagesReceived: 0 })).toEqual({ qaFailRate: 0, llmFailRate: 0 });
    expect(computeFailRates(undefined)).toEqual({ qaFailRate: 0, llmFailRate: 0 });
  });
});

describe('audit cleanup', () => {
  it('删除 180 天前审计', async () => {
    pgQuery.mockResolvedValueOnce({ rowCount: 7 });
    const svc = new PlatformAuditService({} as any);
    await expect(svc.cleanup()).resolves.toBe(7);
    expect(pgQuery).toHaveBeenCalledWith(expect.stringContaining("interval '180 days'"));
  });
});
