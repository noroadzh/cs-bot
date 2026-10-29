import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: jest.fn(), end: jest.fn() })) }));

import { PlatformAuditService } from '../src/platform/platform-audit.service.js';

const oldRow = {
  seq: 1, tenant_id: 't1', action: 'tenant.create', actor: 'op',
  payload: { reason: 'test' }, prev_hash: '', hash: 'h', created_at: new Date('2025-01-01'),
};

describe('audit offsite retention', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'csbot-audit-'));
    setConfig({ PLATFORM_AUDIT_ARCHIVE_DIR: dir });
    poolQuery.mockReset();
  });
  afterEach(async () => { resetConfig(); await rm(dir, { recursive: true, force: true }); });

  it('exports old rows before deleting them', async () => {
    poolQuery
      .mockResolvedValueOnce({ rows: [oldRow] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const deleted = await new PlatformAuditService({} as any).cleanup(180);
    expect(deleted).toBe(1);
    const names = await readdir(dir);
    const content = await readFile(join(dir, names[0]), 'utf8');
    expect(content).toContain('tenant.create');
  });

  it('leaves entries newer than the retention window untouched', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const deleted = await new PlatformAuditService({} as any).cleanup(180);
    expect(deleted).toBe(0);
    // 只有一次 SELECT（按 180 天过滤），既不导出也不删除
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(await readdir(dir)).toEqual([]);
  });

  it('keeps rows when export fails', async () => {
    const file = join(dir, 'not-a-dir');
    await writeFile(file, 'x');
    setConfig({ PLATFORM_AUDIT_ARCHIVE_DIR: file });
    poolQuery.mockResolvedValueOnce({ rows: [oldRow] });
    await expect(new PlatformAuditService({} as any).cleanup(180)).rejects.toBeTruthy();
    expect(poolQuery).toHaveBeenCalledTimes(1);
  });
});
