import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, chmod, copyFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
jest.setTimeout(60_000);

describe('deploy/backup.sh', () => {
  let root: string;
  let fakeBin: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'csbot-backup-'));
    await mkdir(join(root, 'deploy'), { recursive: true });
    await mkdir(join(root, 'data', 'assets'), { recursive: true });
    await writeFile(join(root, 'data', 'assets', 'a.txt'), 'A');
    await copyFile(join(process.cwd(), '..', '..', 'deploy', 'backup.sh'), join(root, 'deploy', 'backup.sh'));
    fakeBin = join(root, 'bin');
    await mkdir(fakeBin, { recursive: true });
    const docker = join(fakeBin, 'docker');
    await writeFile(docker, `#!/bin/sh
case "$*" in
  *" ps pg"*) exit 0;;
  *" ps mongo"*) exit 0;;
  *pg_dump*)
    case "$*" in *csbot_control*) [ "\${FAIL_CONTROL:-0}" = "1" ] && exit 1;; esac
    echo "PGDUMP $*"; exit 0;;
  *mongodump*) echo MONGO; exit 0;;
  *) exit 0;;
esac
`);
    await chmod(docker, 0o755);
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  it('writes adapter, fastgpt, control dumps plus mongo/assets', async () => {
    const backup = join(root, 'backup');
    await exec('bash', [join(root, 'deploy', 'backup.sh')], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, BACKUP_DIR: backup },
    });
    const days = await readdir(backup);
    const files = await readdir(join(backup, days[0]));
    expect(files.some((f) => f.startsWith('pg_adapter_'))).toBe(true);
    expect(files.some((f) => f.startsWith('pg_fastgpt_'))).toBe(true);
    expect(files.some((f) => f.startsWith('pg_control_'))).toBe(true);
    expect(files.some((f) => f.startsWith('mongo_'))).toBe(true);
    expect(files.some((f) => f.startsWith('assets_'))).toBe(true);
  });

  it('exits non-zero when control-plane dump fails', async () => {
    const backup = join(root, 'backup-fail');
    let code = 0;
    try {
      await exec('bash', [join(root, 'deploy', 'backup.sh')], {
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, BACKUP_DIR: backup, FAIL_CONTROL: '1' },
      });
    } catch (e) {
      code = (e as { code?: number }).code ?? 1;
    }
    expect(code).not.toBe(0);
  });
});
