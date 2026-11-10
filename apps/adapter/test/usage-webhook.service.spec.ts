/**
 * UsageWebhookService：失败不拖垮调用方
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const axiosPost = jest.fn() as jest.MockedFunction<(...args: any[]) => Promise<any>>;
jest.mock('axios', () => ({
  __esModule: true,
  default: { post: (...a: unknown[]) => axiosPost(...a) },
}));

import { UsageWebhookService } from '../src/usage/usage-webhook.service.js';

const snapshot = {
  period: 'daily',
  counters: { messagesReceived: 1 },
};

describe('UsageWebhookService', () => {
  beforeEach(() => {
    axiosPost.mockReset();
    resetConfig();
  });

  afterEach(() => resetConfig());

  it('未配置 URL → report 返回 false 且不发请求', async () => {
    setConfig({ USAGE_WEBHOOK_URL: '' });
    const svc = new UsageWebhookService({ getUsage: () => snapshot } as any);
    await expect(svc.report()).resolves.toBe(false);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('POST 成功 → 返回 true', async () => {
    setConfig({ USAGE_WEBHOOK_URL: 'https://hooks.example.com/usage' });
    axiosPost.mockResolvedValueOnce({ status: 200 });
    const svc = new UsageWebhookService({ getUsage: () => snapshot } as any);
    await expect(svc.report()).resolves.toBe(true);
    expect(axiosPost).toHaveBeenCalledWith(
      'https://hooks.example.com/usage',
      snapshot,
      expect.objectContaining({ timeout: 10_000 }),
    );
  });

  it('POST 失败 → 返回 false 且不抛', async () => {
    setConfig({ USAGE_WEBHOOK_URL: 'https://hooks.example.com/usage' });
    axiosPost.mockRejectedValueOnce(new Error('ECONNRESET'));
    const svc = new UsageWebhookService({ getUsage: () => snapshot } as any);
    await expect(svc.report()).resolves.toBe(false);
  });
});
