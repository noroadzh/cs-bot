/**
 * 控制面→数据面同步：内部鉴权、客户端重试、同步服务 payload
 */
import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals';

const axiosPost: any = jest.fn();
jest.mock('axios', () => ({ default: { post: axiosPost }, post: axiosPost }));

import { InternalTokenGuard } from '../src/internal/internal-token.guard.js';
import { HttpTenantSyncClient } from '../src/platform/tenant-sync.client.js';
import { TenantSyncService } from '../src/platform/tenant-sync.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

beforeEach(() => {
  axiosPost.mockReset().mockResolvedValue({ data: { ok: true } });
  setConfig({ TENANT_SYNC_TOKEN: 'sync-token' });
});

afterAll(() => resetConfig());

const ctx = (auth: string) => ({
  switchToHttp: () => ({
    getRequest: () => ({ headers: { authorization: auth } }),
  }),
}) as any;

describe('InternalTokenGuard', () => {
  it('正确 Bearer 通过；错误/缺失 401；未配置 503', () => {
    const guard = new InternalTokenGuard();
    expect(guard.canActivate(ctx('Bearer sync-token'))).toBe(true);
    expect(() => guard.canActivate(ctx('Bearer wrong'))).toThrow();
    setConfig({ TENANT_SYNC_TOKEN: '' });
    expect(() => guard.canActivate(ctx('Bearer sync-token'))).toThrow();
  });
});

describe('HttpTenantSyncClient', () => {
  it('POST /internal/tenant/sync，带 Bearer 与 payload', async () => {
    const client = new HttpTenantSyncClient({ scheme: 'http', verifyTls: false, timeoutMs: 1000 });
    await client.sync(
      { id: 't1', host: '127.0.0.1', port: 30001 },
      'token',
      {
        tenantId: 't1', name: 'T1', status: 'active', expiredAt: null,
        quota: { maxChats: 5, maxStorageMb: 1, maxApiCalls: 2, maxUsers: 3, maxLlmTokensPerMonth: 0 },
      },
    );
    const [url, body, opts] = axiosPost.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:30001/internal/tenant/sync');
    expect(body.quota.maxChats).toBe(5);
    expect(opts.headers.Authorization).toBe('Bearer token');
  });

  it('失败重试 3 次后抛出', async () => {
    axiosPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new HttpTenantSyncClient({ scheme: 'http', verifyTls: false, timeoutMs: 10, maxAttempts: 3 });
    await expect(
      client.sync(
        { id: 't1', host: '127.0.0.1', port: 30001 },
        't',
        {
          tenantId: 't1', name: 'T1', status: 'active', expiredAt: null,
          quota: { maxChats: 1, maxStorageMb: 1, maxApiCalls: 1, maxUsers: 1, maxLlmTokensPerMonth: 0 },
        },
      ),
    ).rejects.toThrow('ECONNREFUSED');
    expect(axiosPost).toHaveBeenCalledTimes(3);
  }, 20_000);
});

describe('TenantSyncService', () => {
  it('读取 control DB 的 tenant/quota 与实例 token，失败写审计', async () => {
    const query: any = jest.fn();
    query
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'T1', status: 'suspended', host: '127.0.0.1', port: 30001, expired_at: null }] })
      .mockResolvedValueOnce({ rows: [{ max_chats: 2, max_storage_mb: 3, max_api_calls: 4, max_users: 5, max_llm_tokens_per_month: 0 }] });
    const audit: any = { append: jest.fn(async (_o: any) => 'hash') };
    const secrets = { load: jest.fn(async () => ({ TENANT_SYNC_TOKEN: 'tok' })) };
    const svc = new TenantSyncService({} as any, secrets as any, audit as any);
    (svc as any).pool = { query, end: jest.fn(async () => undefined) };
    const client = { sync: jest.fn(async (..._args: any[]) => { throw new Error('down'); }) };
    (svc as any).client = client;

    await svc.sync('t1');
    expect(client.sync).toHaveBeenCalledWith(
      { id: 't1', host: '127.0.0.1', port: 30001 },
      'tok',
      expect.objectContaining({
        tenantId: 't1',
        status: 'suspended',
        quota: expect.objectContaining({ maxChats: 2, maxApiCalls: 4 }),
      }),
    );
    expect(audit.append).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.sync', tenantId: 't1' }));
    await svc.onModuleDestroy();
  });
});
