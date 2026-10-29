import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const axiosPost = jest.fn(async () => ({ data: { data: { total: 3 } } })) as any;
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => axiosPost(...a) } }));
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: jest.fn(async () => ({ rows: [{ n: 0 }] })), end: jest.fn(async () => undefined) })) }));

import { CapacityUsageService } from '../src/usage/capacity-usage.service.js';

describe('CapacityUsageService.countDocuments', () => {
  beforeEach(() => axiosPost.mockClear());
  afterEach(() => resetConfig());

  it('sums FastGPT collection totals', async () => {
    setConfig({ FASTGPT_BASE_URL: 'http://fg', FASTGPT_API_KEY: 'k'.repeat(10), FASTGPT_DATASET_IDS: 'd1,d2' });
    const svc = new CapacityUsageService();
    await expect(svc.countDocuments()).resolves.toBe(6);
    expect(axiosPost).toHaveBeenCalledTimes(2);
    await svc.onModuleDestroy();
  });

  it('throws instead of returning zero when unavailable', async () => {
    setConfig({ FASTGPT_BASE_URL: '', FASTGPT_API_KEY: '' });
    const svc = new CapacityUsageService();
    await expect(svc.countDocuments()).rejects.toBeTruthy();
    await svc.onModuleDestroy();
  });

  it('throws when the FastGPT call fails', async () => {
    setConfig({ FASTGPT_BASE_URL: 'http://fg', FASTGPT_API_KEY: 'k'.repeat(10), FASTGPT_DATASET_IDS: 'd1' });
    axiosPost.mockRejectedValueOnce(new Error('down'));
    const svc = new CapacityUsageService();
    await expect(svc.countDocuments()).rejects.toThrow('down');
    await svc.onModuleDestroy();
  });
});
