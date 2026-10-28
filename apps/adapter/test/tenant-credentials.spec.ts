import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: jest.fn() })) }));

import { TenantService } from '../src/platform/tenant.service.js';
import { AppLogger } from '../src/common/logger.js';

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', name: 'T', status: 'active', host: 'h', port: 1, database_url: null,
  created_at: new Date(), updated_at: new Date(), expired_at: null, last_provision_log: null, deleted_at: null, ...over,
});

describe('TenantService.handoffCredentials', () => {
  beforeEach(() => { setConfig(); poolQuery.mockReset(); });
  afterEach(() => resetConfig());

  it('returns generated credentials once and rejects a second read', async () => {
    const secrets = {
      load: jest.fn(async () => ({
        ADMIN_PASSWORD: 'ADMIN-SECRET-XYZ',
        FASTGPT_ROOT_PASSWORD: 'ROOT-SECRET-ABC',
        POSTGRES_PASSWORD: 'p',
      })),
    };
    const audit: any = jest.fn(async () => 'h');
    const svc = new TenantService(
      { append: audit } as any,
      { getQuota: jest.fn(async () => null), ensureDefaultQuota: jest.fn() } as any,
      { todaySummary: jest.fn(async () => ({ day: '', chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 })) } as any,
      {} as any,
      secrets as any,
    );
    poolQuery
      .mockResolvedValueOnce({ rows: [row()] }) // requireTenant
      .mockResolvedValueOnce({ rows: [{ credentials_handed_at: null }] })
      .mockResolvedValueOnce({ rows: [] }); // update

    const logSpy = jest.spyOn(AppLogger.prototype, 'log').mockImplementation(() => undefined as any);
    const warnSpy = jest.spyOn(AppLogger.prototype, 'warn').mockImplementation(() => undefined as any);
    const errSpy = jest.spyOn(AppLogger.prototype, 'error').mockImplementation(() => undefined as any);
    const out = await svc.handoffCredentials('t1', 'op');
    expect(out).toEqual({ ADMIN_PASSWORD: 'ADMIN-SECRET-XYZ', FASTGPT_ROOT_PASSWORD: 'ROOT-SECRET-ABC' });
    const logged = JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errSpy.mock.calls]);
    expect(logged).not.toContain('ADMIN-SECRET-XYZ');
    expect(logged).not.toContain('ROOT-SECRET-ABC');
    logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.credentials', payload: { keys: ['ADMIN_PASSWORD', 'FASTGPT_ROOT_PASSWORD'] } }));

    poolQuery
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [{ credentials_handed_at: new Date() }] });
    let status = 0;
    try { await svc.handoffCredentials('t1', 'op'); } catch (e) { status = (e as any).getStatus(); }
    expect(status).toBe(410);
  });
});
