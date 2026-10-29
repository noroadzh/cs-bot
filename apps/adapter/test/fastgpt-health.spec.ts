import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: jest.fn(async () => ({ rows: [] })) })) }));
jest.mock('axios', () => ({
  __esModule: true,
  default: { create: jest.fn(() => ({ get: jest.fn(), post: jest.fn() })), get: jest.fn(), post: jest.fn() },
}));

import { FastGPTQaEngine } from '../src/qa/fastgpt-qa.engine.js';

describe('FastGPT hybrid health', () => {
  beforeEach(() => setConfig({ MODEL_MODE: 'hybrid', FASTGPT_BASE_URL: 'http://fg', FASTGPT_API_KEY: 'k'.repeat(8) }));
  afterEach(() => resetConfig());

  it('marks degraded on probe failure and recovers after 5 minutes healthy', async () => {
    const engine = new FastGPTQaEngine({} as any, { search: async () => null } as any);
    const get: any = jest.fn();
    // 健康探测走独立的 HTTP 实例（业务请求已改经 FastGPTClient）
    (engine as any).primaryHttp = { get };
    get.mockRejectedValueOnce(new Error('down'));
    await expect(engine.probeHealth(1000)).resolves.toBe(false);
    expect(engine.isHealthy(1000)).toBe(false);

    get.mockResolvedValue({ status: 200 });
    await expect(engine.probeHealth(2000)).resolves.toBe(true);
    expect(engine.isHealthy(2000)).toBe(false); // 尚未满 5 分钟
    expect(engine.isHealthy(2000 + 5 * 60_000)).toBe(true);
  });
});
