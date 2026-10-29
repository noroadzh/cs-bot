import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
const readdir = jest.fn() as any;
const stat = jest.fn() as any;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, end: jest.fn() })) }));
jest.mock('node:fs', () => ({ promises: { readdir, stat } }));

import { CapacityGuard } from '../src/usage/capacity-guard.service.js';

const quota = (over: Record<string, unknown> = {}) => ({ max_qa: 0, max_docs: 0, max_asset_mb: 0, ...over });

describe('CapacityGuard', () => {
  beforeEach(() => {
    setConfig({ TENANT_ID: 't1' });
    poolQuery.mockReset();
    readdir.mockReset().mockResolvedValue([]);
    stat.mockReset();
  });
  afterEach?.(() => resetConfig());

  it('does nothing outside M11', async () => {
    setConfig({ TENANT_ID: '' });
    const g = new CapacityGuard();
    await expect(g.checkAsset(10)).resolves.toBeUndefined();
    expect(poolQuery).not.toHaveBeenCalled();
    resetConfig();
  });

  it('allows unlimited capacity (0)', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [quota()] });
    const g = new CapacityGuard();
    await expect(g.checkAsset(10)).resolves.toBeUndefined();
  });

  it('rejects an asset that exceeds maxAssetMb', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [quota({ max_asset_mb: 1 })] });
    readdir.mockResolvedValueOnce(['a.bin']);
    stat.mockResolvedValueOnce({ isDirectory: () => false, size: 900 * 1024 });
    const g = new CapacityGuard();
    let status = 0;
    try { await g.checkAsset(200 * 1024); } catch (e) { status = (e as any).getStatus(); }
    expect(status).toBe(409);
  });

  it('rejects import when maxQa would be exceeded', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [quota({ max_qa: 2 })] })
      .mockResolvedValueOnce({ rows: [{ n: 1 }] });
    const g = new CapacityGuard();
    let status = 0;
    try { await g.checkImport(2, 0); } catch (e) { status = (e as any).getStatus(); }
    expect(status).toBe(409);
  });

  it('rejects import when maxDocs would be exceeded', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [quota({ max_docs: 2 })] });
    const capacity = { countDocuments: jest.fn(async () => 1) } as any;
    const g = new CapacityGuard(capacity);
    let status = 0;
    try { await g.checkImport(0, 2); } catch (e) { status = (e as any).getStatus(); }
    expect(status).toBe(409);
  });

  it('fails closed when document count is unavailable', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [quota({ max_docs: 10 })] });
    const capacity = { countDocuments: jest.fn(async () => { throw new Error('mongo down'); }) } as any;
    const g = new CapacityGuard(capacity);
    let status = 0;
    try { await g.checkImport(0, 1); } catch (e) { status = (e as any).getStatus(); }
    expect(status).toBe(503);
  });
});
