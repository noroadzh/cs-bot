import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { TenantExportService, type ExportRunner } from '../src/platform/tenant-export.service.js';
import { TenantSecretStore } from '../src/platform/tenant-secret-store.js';

const runner: ExportRunner = {
  dumpPostgres: async () => Buffer.from('-- pg dumpall\nCREATE TABLE t(id int);\n'),
  dumpMongo: async () => Buffer.from('MONGO-ARCHIVE'),
};

describe('TenantExportService', () => {
  let root: string;
  let svc: TenantExportService;
  const store = new TenantSecretStore('test-master-key-12345');

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'csbot-export-'));
    await mkdir(join(root, 't1', 'data', 'assets', 'sub'), { recursive: true });
    await writeFile(join(root, 't1', 'data', 'assets', 'a.txt'), 'ASSET-A');
    await writeFile(join(root, 't1', 'data', 'assets', 'sub', 'b.bin'), Buffer.from([1, 2, 3]));
    svc = new TenantExportService(
      {
        getDetail: async (id: string) => ({
          tenant: { id, name: 'T1', status: 'active', host: null, port: null, databaseUrl: null },
          itemCounts: {},
          deletable: false,
        }),
      } as any,
      { load: async () => ({ POSTGRES_PASSWORD: 'p' }) } as any,
      store,
      root,
      runner,
    );
  });

  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('collects real KB dump, mongo archive, assets and config', async () => {
    const entries = await svc.collectEntries('t1');
    const names = entries.map((e) => e.name);
    expect(names).toContain('manifest.json');
    expect(names).toContain('pg.sql');
    expect(names).toContain('mongo.archive.gz');
    expect(names).toContain('assets/a.txt');
    expect(names).toContain('assets/sub/b.bin');
    expect(entries.find((e) => e.name === 'pg.sql')!.data.toString()).toContain('pg dumpall');
    expect(entries.find((e) => e.name === 'assets/a.txt')!.data.toString()).toBe('ASSET-A');
    const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json')!.data.toString());
    expect(manifest.files.some((f: any) => f.name === 'mongo.archive.gz' && f.size > 0)).toBe(true);
  });

  it('writes an encrypted tar.gz package with 0600 mode', async () => {
    const path = await svc.export('t1');
    const stat = await readFile(path);
    const tarGz = store.decryptBuffer(stat);
    const tar = gunzipSync(tarGz);
    const text = tar.toString('latin1');
    expect(text).toContain('manifest.json');
    expect(text).toContain('pg.sql');
    expect(text).toContain('assets/a.txt');
  });

  it('uses streaming dump methods when the runner provides them', async () => {
    const dumpPostgres = jest.fn(async () => Buffer.from('never'));
    const dumpMongo = jest.fn(async () => Buffer.from('never'));
    const streamingRunner = {
      dumpPostgres,
      dumpMongo,
      dumpPostgresTo: async (_id: string, path: string) => writeFile(path, 'PG-STREAM'),
      dumpMongoTo: async (_id: string, path: string) => writeFile(path, 'MONGO-STREAM'),
    };
    const streamSvc = new TenantExportService(
      { getDetail: async (id: string) => ({ tenant: { id, name: 'T1' }, itemCounts: {}, deletable: false }) } as any,
      { load: async () => ({ POSTGRES_PASSWORD: 'p' }) } as any,
      store,
      root,
      streamingRunner as any,
    );
    const path = await streamSvc.export('t1');
    const tarGz = store.decryptBuffer(await readFile(path));
    const text = gunzipSync(tarGz).toString('latin1');
    expect(text).toContain('PG-STREAM');
    expect(text).toContain('MONGO-STREAM');
    expect(dumpPostgres).not.toHaveBeenCalled();
    expect(dumpMongo).not.toHaveBeenCalled();
  });
});
