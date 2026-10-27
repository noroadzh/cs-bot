/**
 * 按租户备份脚本：每租户命令序列、失败隔离、产物落盘
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'backup-tenants.sh');
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csbot-backup-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  const tenants = join(dir, 'tenants');
  for (const id of ['tenant-a', 'tenant-b']) {
    await mkdir(join(tenants, id, 'data'), { recursive: true });
    await mkdir(join(tenants, id, 'license'), { recursive: true });
    await writeFile(join(tenants, id, 'data', 'asset.txt'), 'asset', 'utf8');
    await writeFile(join(tenants, id, 'license', 'license.lic'), 'lic', 'utf8');
    await writeFile(join(tenants, id, 'docker-compose.yml'), `name: csbot-t-${id}\n`, 'utf8');
  }
  const log = join(dir, 'docker.log');
  const fake = join(dir, 'fake-docker.sh');
  await writeFile(
    fake,
    `#!/bin/sh\necho "docker $@" >> "${log}"\ncase "$*" in\n  *csbot-t-tenant-b*) exit 1;;\nesac\nif [ "$1" = compose ] && [ "$5" = exec ]; then echo MOCK-DUMP; fi\nif [ "$1" = compose ] && [ "$7" = exec ]; then echo MOCK-MONGO; fi\nexit 0\n`,
    'utf8',
  );
  await chmod(fake, 0o755);
  return { tenants, log, fake };
}

describe('backup-tenants.sh', () => {
  it('备份每个租户；单租户失败继续，最终退出非 0', async () => {
    const { tenants, log, fake } = await setup();
    const backups = join(dir, 'backups');
    let code = 0;
    try {
      await execFileP('bash', [SCRIPT], {
        env: {
          ...process.env,
          PLATFORM_COMPOSE_DIR: tenants,
          BACKUP_DIR: backups,
          PLATFORM_DOCKER_BIN: fake,
        },
      });
    } catch (e) {
      code = (e as any).code ?? 1;
    }
    expect(code).toBe(1);
    const calls = await readFile(log, 'utf8');
    expect(calls).toContain('csbot-t-tenant-a');
    expect(calls).toContain('csbot-t-tenant-b');
    const aDir = join(backups, 'tenants', 'tenant-a');
    const entries = await readFile(log, 'utf8');
    expect(entries).toContain('exec -T pg');
    const aBackups = await import('node:fs/promises').then((fs) => fs.readdir(aDir));
    expect(aBackups.length).toBe(1);
    const files = await import('node:fs/promises').then((fs) => fs.readdir(join(aDir, aBackups[0])));
    expect(files.some((f) => f.startsWith('pg_'))).toBe(true);
    expect(files.some((f) => f.startsWith('mongo_'))).toBe(true);
    expect(files.some((f) => f.startsWith('data_'))).toBe(true);
    expect((await stat(join(aDir, aBackups[0]))).isDirectory()).toBe(true);
  }, 20_000);
});
