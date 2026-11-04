import { describe, it, expect, jest, beforeEach } from '@jest/globals';

const get = jest.fn() as jest.MockedFunction<(url: string, opts?: unknown) => Promise<{ data: unknown }>>;
const post = jest.fn() as jest.MockedFunction<(url: string, body: unknown, opts?: unknown) => Promise<{ status: number }>>;
jest.mock('axios', () => ({
  default: { get, post },
  get,
  post,
}));

import { HttpTenantInstanceClient } from '../src/platform/tenant-instance.client.js';

describe('HttpTenantInstanceClient', () => {
  const client = new HttpTenantInstanceClient({
    scheme: 'http',
    verifyTls: true,
    timeoutMs: 1000,
    maxAttempts: 1,
  });

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('fetchFingerprint validates 64 hex', async () => {
    get.mockResolvedValue({ data: { fingerprint: 'd'.repeat(64) } });
    const fp = await client.fetchFingerprint({ host: 'h', port: 1 }, 'tok');
    expect(fp).toBe('d'.repeat(64));
    expect(get).toHaveBeenCalledWith(
      'http://h:1/internal/instance/fingerprint',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok' },
      }),
    );
  });

  it('fetchFingerprint rejects invalid payload', async () => {
    get.mockResolvedValue({ data: { fingerprint: 'short' } });
    await expect(client.fetchFingerprint({ host: 'h', port: 1 }, 'tok')).rejects.toThrow(/invalid/);
  });

  it('reloadLicense posts admin basic auth', async () => {
    post.mockResolvedValue({ status: 200 });
    await client.reloadLicense({ host: 'h', port: 1 }, 'admin', 'secret');
    expect(post).toHaveBeenCalledWith(
      'http://h:1/admin/license/reload',
      {},
      expect.objectContaining({
        headers: { Authorization: expect.stringMatching(/^Basic /) },
      }),
    );
  });
});
