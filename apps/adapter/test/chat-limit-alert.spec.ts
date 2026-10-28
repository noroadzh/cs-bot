import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
const axiosPost = jest.fn(async () => ({ status: 200 })) as any;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery })) }));
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => axiosPost(...a) } }));

import { LicensedChatService } from '../src/license/licensed-chat.service.js';

describe('chat limit alert', () => {
  beforeAll(() => setConfig({ OPS_WEBHOOK_URL: 'https://ops.example/hook' }));
  afterAll(() => resetConfig());
  beforeEach(() => { poolQuery.mockReset(); axiosPost.mockClear(); });

  it('alerts once per group when maxChats is reached', async () => {
    poolQuery.mockResolvedValue({ rows: [{ chat_id: 'c1' }] });
    const svc = new LicensedChatService({ getState: () => ({ maxChats: 1 }) } as never);
    await svc.load();
    await expect(svc.ensureChat('c2')).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(axiosPost).toHaveBeenCalledTimes(1);
    await expect(svc.ensureChat('c2')).resolves.toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(axiosPost).toHaveBeenCalledTimes(1);
  });
});
