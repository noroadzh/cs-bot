import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: jest.fn() })),
}));

import { TenantService } from '../src/platform/tenant.service.js';

const PLACEHOLDER = 'b'.repeat(64);
const LIVE = 'c'.repeat(64);

function tenantRow(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    name: 'T',
    status: 'active',
    host: '127.0.0.1',
    port: 8443,
    database_url: null,
    plan: 'standard',
    tenancy_mode: 'dedicated',
    fingerprint: null,
    fingerprint_pending: false,
    created_at: new Date(),
    updated_at: new Date(),
    expired_at: '2027-01-01T00:00:00Z',
    last_provision_log: null,
    deleted_at: null,
    ...over,
  };
}

function svcWith(
  instanceClient: { fetchFingerprint: jest.Mock; reloadLicense: jest.Mock },
  secrets?: { load: jest.Mock },
) {
  const issue = jest.fn<(input: { fingerprint?: string }) => Promise<void>>(async () => undefined);
  const restart = jest.fn(async () => undefined);
  const s = new TenantService(
    { append: jest.fn(async () => 'h') } as any,
    { getQuota: jest.fn(async () => ({ maxChats: 5 })), ensureDefaultQuota: jest.fn() } as any,
    { todaySummary: jest.fn(async () => ({ day: '', chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 })) } as any,
    {} as any,
    secrets as any,
  );
  s.setInstanceClient(instanceClient as any);
  s.setLicenseIssuer({ issue } as any);
  s.setProvisioner({ restart } as any);
  return { s, issue, restart };
}

describe('TenantService fingerprint rebind', () => {
  beforeEach(() => {
    resetConfig();
    setConfig({
      LICENSE_ISSUER: 'noop',
      PLATFORM_LICENSE_FINGERPRINT: PLACEHOLDER,
    });
    poolQuery.mockReset();
  });
  afterEach(() => resetConfig());

  it('post-provision: live fingerprint unchanged → skip reissue', async () => {
    const client = {
      fetchFingerprint: jest.fn(async () => PLACEHOLDER),
      reloadLicense: jest.fn(async () => undefined),
    };
    const secrets = { load: jest.fn(async () => ({ TENANT_SYNC_TOKEN: 'tok' })) };
    const { s, issue } = svcWith(client, secrets);

    poolQuery
      .mockResolvedValueOnce({ rows: [tenantRow({ fingerprint: PLACEHOLDER })] })
      .mockResolvedValueOnce({ rows: [] });

    await (s as any).runFingerprintRebind('t1', 'op', PLACEHOLDER);

    expect(issue).not.toHaveBeenCalled();
    expect(client.reloadLicense).not.toHaveBeenCalled();
  });

  it('post-provision: live differs → reissue + reload', async () => {
    setConfig({ LICENSE_ISSUER: 'noop', PLATFORM_LICENSE_FINGERPRINT: PLACEHOLDER });
    const client = {
      fetchFingerprint: jest.fn(async () => LIVE),
      reloadLicense: jest.fn(async () => undefined),
    };
    const secrets = {
      load: jest.fn(async () => ({ TENANT_SYNC_TOKEN: 'tok', ADMIN_PASSWORD: 'pw' })),
    };
    const { s, issue } = svcWith(client, secrets);

    poolQuery
      .mockResolvedValueOnce({ rows: [tenantRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [tenantRow({ fingerprint: LIVE })] })
      .mockResolvedValueOnce({ rows: [] });

    await (s as any).runFingerprintRebind('t1', 'op', PLACEHOLDER);

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: LIVE }));
    expect(client.reloadLicense).toHaveBeenCalled();
  });

  it('collect unreachable → fingerprint pending + audit failure', async () => {
    const client = {
      fetchFingerprint: jest.fn(async () => {
        throw new Error('timeout');
      }),
      reloadLicense: jest.fn(),
    };
    const secrets = { load: jest.fn(async () => ({ TENANT_SYNC_TOKEN: 'tok' })) };
    const audit = jest.fn<(entry: unknown) => Promise<string>>(async () => 'h');
    const s = new TenantService(
      { append: audit } as any,
      { getQuota: jest.fn(), ensureDefaultQuota: jest.fn() } as any,
      { todaySummary: jest.fn() } as any,
      {} as any,
      secrets as any,
    );
    s.setInstanceClient(client as any);

    poolQuery
      .mockResolvedValueOnce({ rows: [tenantRow()] })
      .mockResolvedValueOnce({ rows: [] });

    await (s as any).runFingerprintRebind('t1', 'op', PLACEHOLDER);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'license.reissue_failed', payload: expect.objectContaining({ phase: 'collect' }) }),
    );
    expect(poolQuery).toHaveBeenCalledWith(
      expect.stringContaining('fingerprint_pending'),
      ['t1', true],
    );
  });

  it('reissueLicense operator API uses current tenant fingerprint', async () => {
    setConfig({ LICENSE_ISSUER: 'noop' });
    const client = {
      fetchFingerprint: jest.fn(),
      reloadLicense: jest.fn(async () => undefined),
    };
    const secrets = {
      load: jest.fn(async () => ({ TENANT_SYNC_TOKEN: 'tok', ADMIN_PASSWORD: 'pw' })),
    };
    const { s, issue } = svcWith(client, secrets);

    poolQuery
      .mockResolvedValueOnce({ rows: [tenantRow({ fingerprint: LIVE })] })
      .mockResolvedValueOnce({ rows: [tenantRow({ fingerprint: LIVE })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [tenantRow({ fingerprint: LIVE, fingerprint_pending: false })] });

    await s.reissueLicense('t1', 'operator');

    expect(issue).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: LIVE }));
    expect(client.reloadLicense).toHaveBeenCalled();
  });
});
