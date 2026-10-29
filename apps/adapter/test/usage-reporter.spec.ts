import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const axiosPost = jest.fn(async () => ({ status: 200 })) as any;
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => axiosPost(...a) } }));

const readFile = jest.fn(async () => '[]') as any;
const writeFile = jest.fn(async () => undefined) as any;
const mkdir = jest.fn(async () => undefined) as any;
jest.mock('node:fs', () => ({ promises: { readFile, writeFile, mkdir } }));

import { UsageReporterScheduler } from '../src/usage/usage-reporter.scheduler.js';

const counters = {
  messagesReceived: 10,
  messagesTriggered: 8,
  messagesAnswered: 6,
  messagesMissed: 2,
  tokensPrimary: 100,
  tokensFallback: 20,
};

const makeScheduler = (snapshot: () => Promise<any>) =>
  new UsageReporterScheduler(
    { report: jest.fn(async () => true) } as any,
    { getUsage: () => ({ counters }) } as any,
    { snapshot } as any,
  );

describe('UsageReporterScheduler capacity snapshot', () => {
  afterEach(() => {
    resetConfig();
    axiosPost.mockClear();
    readFile.mockClear();
    writeFile.mockClear();
    mkdir.mockClear();
  });

  it('skips the report instead of sending docCount: 0 when the count is unavailable', async () => {
    setConfig({ CONTROL_PLANE_URL: 'http://cp.local', USAGE_WEBHOOK_URL: '' });
    const scheduler = makeScheduler(async () => {
      throw new Error('FastGPT unavailable');
    });

    await scheduler.reportDaily();

    expect(axiosPost).not.toHaveBeenCalled();
    // 不写缓冲：下一次调度重新取快照（唯一一次写盘是清理空缓冲）
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0][1]).toBe('[]');
  });

  it('sends the capacity counters when the snapshot is available', async () => {
    setConfig({ CONTROL_PLANE_URL: 'http://cp.local', USAGE_WEBHOOK_URL: '', TENANT_ID: 't1' });
    const scheduler = makeScheduler(async () => ({ docCount: 42, qaCount: 7, assetMb: 1.5, activeChats: 3 }));

    await scheduler.reportDaily();

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost.mock.calls[0][0]).toBe('http://cp.local/platform/report');
    expect(axiosPost.mock.calls[0][1]).toMatchObject({ tenantId: 't1', docCount: 42, qaCount: 7, assetMb: 1.5 });
  });
});
