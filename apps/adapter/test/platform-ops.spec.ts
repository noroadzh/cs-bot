/**
 * M11 运营：配额预警、订阅提醒通知、D10 上报、审计清理
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import net from 'node:net';

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
import { computeFailRates, buildHealthUrl } from '../src/platform/platform-monitor.js';
import { MultiNotifier, SmtpNotifier, SubscriptionReminder, WebhookNotifier } from '../src/platform/subscription-reminder.js';
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
        { id: 'a', name: 'A', expiresAt: days(30), contact: 'a@example.com' },
        { id: 'b', name: 'B', expiresAt: days(15), contact: 'b@example.com' },
        { id: 'c', name: 'C', expiresAt: days(20), contact: 'c@example.com' },
      ],
      now,
    );
    expect(count).toBe(2);
    expect(sent.length).toBe(4); // 有邮箱的租户：租户邮件 + 运维
  });

  it('没有邮箱联系人时跳过租户邮件，仍通知运维', async () => {
    const sent: string[] = [];
    const targets: string[] = [];
    const reminder = new SubscriptionReminder({
      send: async (target, subject) => { targets.push(target); sent.push(subject); },
    });
    const now = new Date('2026-10-27T00:00:00Z');
    const count = await reminder.dispatch(
      [{ id: 'a', name: 'A', expiresAt: new Date(now.getTime() + 30 * 86_400_000), contact: '' }],
      now,
    );
    expect(count).toBe(1);
    expect(sent).toEqual(['[运营] 租户到期提醒 T-30']);
    expect(targets).toEqual(['ops']);
  });

  it('SMTP_HOST 配置后把邮件交给本地 SMTP', async () => {
    const messages: string[] = [];
    const server = net.createServer((socket) => {
      socket.write('220 localhost ESMTP\r\n');
      let buf = '';
      let dataMode = false;
      let body = '';
      socket.on('data', (chunk) => {
        buf += chunk.toString();
        if (!dataMode) {
          const lines = buf.split('\r\n');
          buf = lines.pop() ?? '';
          for (const line of lines) {
            const upper = line.toUpperCase();
            if (upper === 'DATA') {
              dataMode = true;
              socket.write('354 go\r\n');
            } else if (upper === 'QUIT') {
              socket.write('221 bye\r\n');
              socket.end();
            } else {
              socket.write('250 ok\r\n');
            }
          }
        } else {
          body += buf;
          buf = '';
          if (body.includes('\r\n.\r\n')) {
            messages.push(body);
            body = '';
            dataMode = false;
            socket.write('250 queued\r\n');
          }
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    try {
      await new SmtpNotifier({
        host: '127.0.0.1',
        port,
        from: 'bot@example.com',
        timeoutMs: 3000,
      }).send('tenant@example.com', 'T-30', '请续费');
      expect(messages.some((m) => m.includes('tenant@example.com') && m.includes('请续费'))).toBe(true);
      await new SmtpNotifier({ host: '127.0.0.1', port, from: 'bot@example.com' }).send('not-an-email', 'x', 'y');
      expect(messages).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
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

    const withCapacity = buildControlPlanePayload('T-1', counters, new Date('2026-10-27T10:00:00Z'), {
      docCount: 3, qaCount: 4, assetMb: 5, activeChats: 2,
    });
    expect(withCapacity).toMatchObject({ docCount: 3, qaCount: 4, assetMb: 5, activeChats: 2 });
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

describe('instance health URL', () => {
  it('使用 host+port+scheme 构造 healthz', () => {
    expect(buildHealthUrl('t1.example.com', 30010)).toBe('https://t1.example.com:30010/healthz');
    expect(buildHealthUrl('127.0.0.1', 18001, 'http')).toBe('http://127.0.0.1:18001/healthz');
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
  it('MultiNotifier 同时发送 webhook 与邮件通道', async () => {
    const calls: string[] = [];
    const n = new MultiNotifier([
      { send: async () => { calls.push('webhook'); } },
      { send: async () => { calls.push('email'); } },
    ]);
    await n.send('ops', 's', 'b');
    expect(calls.sort()).toEqual(['email', 'webhook']);
  });
});
