/**
 * HttpHealthSource：/healthz resources 映射为实例 cpuPct/memPct
 */
import { describe, it, expect, jest } from '@jest/globals';

const axiosGet = jest.fn() as jest.MockedFunction<(...a: unknown[]) => Promise<any>>;
jest.mock('axios', () => ({ __esModule: true, default: { get: (...a: unknown[]) => axiosGet(...a) } }));

const poolQuery = jest.fn(async () => ({ rows: [{ host: 'h', port: 30000 }] })) as any;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, end: jest.fn(async () => undefined) })) }));

import { HttpHealthSource } from '../src/platform/platform-monitor.js';

describe('HttpHealthSource resource metrics', () => {
  it('maps resources from /healthz', async () => {
    axiosGet.mockResolvedValueOnce({
      status: 200,
      data: {
        usage: { messagesReceived: 10, messagesAnswered: 9, messagesMissed: 1, llmFailures: 0 },
        resources: { cpuPct: 42.5, memPct: 77.1 },
      },
    });
    const src = new HttpHealthSource('postgresql://x', { scheme: 'https', verifyTls: false });
    const health = await src.probe('t1');
    expect(health).toMatchObject({ tenantId: 't1', healthy: true, cpuPct: 42.5, memPct: 77.1 });
    await src.close();
  });

  it('leaves metrics undefined when the payload omits them', async () => {
    axiosGet.mockResolvedValueOnce({ status: 200, data: { usage: {} } });
    const src = new HttpHealthSource('postgresql://x', { scheme: 'https', verifyTls: false });
    const health = await src.probe('t1');
    expect(health.cpuPct).toBeUndefined();
    expect(health.memPct).toBeUndefined();
    await src.close();
  });
});
