import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: jest.fn() })) }));

import { TenantService } from '../src/platform/tenant.service.js';

const row = (over: Record<string, unknown> = {}) => ({
  id: 't1', name: 'T', status: 'active', host: 'h', port: 1, database_url: null,
  created_at: new Date(), updated_at: new Date(), expired_at: '2027-01-01T00:00:00Z',
  last_provision_log: null, deleted_at: null, ...over,
});

describe('renew license file handoff', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'csbot-renew-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  beforeEach(() => { poolQuery.mockReset(); resetConfig(); });

  it('copies the reissued license into the tenant mount', async () => {
    setConfig({
      LICENSE_ISSUER: 'noop',
      LICENSE_ISSUER_OUT_DIR: join(root, 'licenses'),
      PLATFORM_COMPOSE_DIR: join(root, 'tenants'),
    });
    const issuer = {
      issue: jest.fn(async (t: { id: string }) => {
        const dir = join(root, 'licenses', t.id, 'license');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'license.lic'), 'NEW-LICENSE');
      }),
    };
    const svc = new TenantService(
      { append: jest.fn(async () => 'h') } as any,
      { getQuota: jest.fn(async () => null), ensureDefaultQuota: jest.fn() } as any,
      { todaySummary: jest.fn(async () => ({ day: '', chatCount: 0, apiCallCount: 0, storageBytes: 0, userCount: 0 })) } as any,
      {} as any,
    );
    svc.setLicenseIssuer(issuer as any);
    poolQuery
      .mockResolvedValueOnce({ rows: [row()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [row()] });

    await svc.renew('t1', 30, 'op');

    expect(issuer.issue).toHaveBeenCalled();
    const dest = join(root, 'tenants', 't1', 'license', 'license.lic');
    expect(await readFile(dest, 'utf8')).toBe('NEW-LICENSE');
  });
});
