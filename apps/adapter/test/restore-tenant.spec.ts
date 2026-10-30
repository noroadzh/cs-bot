/**
 * 租户按需恢复脚本：缺参/未知租户/无备份快速失败；dry-run 只打印；未确认不执行
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'restore-tenant.sh');

let dir: string;

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'csbot-restore-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const DOCKER_MARKER = () => join(dir, 'docker-called.log');

function makeRoots(opts: { withBackup?: boolean; compose?: boolean } = {}): { tenantRoot: string; backupRoot: string; docker: string } {
  const tenantRoot = mkdtempSync(join(dir, 'tenants-'));
  const backupRoot = mkdtempSync(join(dir, 'backup-'));
  const docker = join(dir, 'fake-docker.sh');
  writeFileSync(docker, `#!/bin/sh\necho "$@" >> ${DOCKER_MARKER()}\nexit 0\n`);
  chmodSync(docker, 0o755);

  const id = 't1';
  if (opts.compose !== false) {
    mkdirSync(join(tenantRoot, id), { recursive: true });
    writeFileSync(join(tenantRoot, id, 'docker-compose.yml'), 'services: {}\n');
  }
  if (opts.withBackup) {
    const snap = join(backupRoot, 'tenants', id, '20260101_000000');
    mkdirSync(snap, { recursive: true });
    writeFileSync(join(snap, 'pg_t1.sql.gz'), 'x');
    writeFileSync(join(snap, 'mongo_t1.archive.gz'), 'x');
  }
  return { tenantRoot, backupRoot, docker };
}

function run(args: string[], roots: { tenantRoot: string; backupRoot: string; docker: string }): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      env: {
        ...process.env,
        PLATFORM_COMPOSE_DIR: roots.tenantRoot,
        BACKUP_DIR: roots.backupRoot,
        PLATFORM_DOCKER_BIN: roots.docker,
      },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: e.status ?? 1, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

describe('scripts/restore-tenant.sh', () => {
  it('fails when tenantId is missing', () => {
    const r = run([], makeRoots());
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('tenantId is required');
  });

  it('fails when the tenant compose is missing', () => {
    const r = run(['t1'], makeRoots({ compose: false, withBackup: true }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('tenant compose not found');
  });

  it('fails when the tenant has no backup', () => {
    const r = run(['t1'], makeRoots({ withBackup: false }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('no backup dir');
  });

  it('--dry-run prints the plan without invoking docker', () => {
    const roots = makeRoots({ withBackup: true });
    const r = run(['t1', '--dry-run'], roots);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('20260101_000000');
    expect(r.stdout).toContain('psql');
    expect(r.stdout).toContain('mongorestore');
    expect(existsSync(DOCKER_MARKER())).toBe(false);
  });

  it('refuses to restore without --yes', () => {
    const roots = makeRoots({ withBackup: true });
    const r = run(['t1'], roots);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--yes');
    expect(existsSync(DOCKER_MARKER())).toBe(false);
  });
});
