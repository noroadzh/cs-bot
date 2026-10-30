/**
 * 交付打包：白名单产物 + 内部制品拒绝
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'package-delivery.sh');

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'csbot-pkg-'));
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

function runPackage(env: Record<string, string>): string {
  return execFileSync('bash', [SCRIPT], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

describe('package-delivery', () => {
  it('produces an allowlisted package with verifiable checksums', () => {
    runPackage({ VERSION: '9.9.9', OUT_DIR: outDir });
    const tar = join(outDir, 'cs-bot-deploy-9.9.9.tar.gz');
    const list = execFileSync('tar', ['-tzf', tar], { encoding: 'utf8' });

    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/docker-compose.yml');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/nginx/nginx.conf');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/nginx/fastgpt-admin-allow.conf');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/install.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/collect-logs.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/.env.template');
    expect(list).toContain('cs-bot-deploy-9.9.9/config/keywords.yml');
    expect(list).toContain('cs-bot-deploy-9.9.9/apps/adapter/src/platform/007-tenant.sql');
    expect(list).toContain('cs-bot-deploy-9.9.9/SHA256SUMS.txt');

    expect(list).not.toMatch(/tools\//);
    expect(list).not.toMatch(/\.pem$/m);
    expect(list).not.toContain('docker-compose.saas.yml');
    expect(list).not.toContain('docker-compose.control-plane-expose.yml');
    expect(list).not.toContain('license/license.lic');
    expect(list).not.toContain('nginx/certs');

    const extractDir = mkdtempSync(join(tmpdir(), 'csbot-pkg-x-'));
    try {
      execFileSync('tar', ['-xzf', tar, '-C', extractDir]);
      const pkg = join(extractDir, 'cs-bot-deploy-9.9.9');
      execFileSync(
        'bash',
        ['-lc', 'if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS.txt; else shasum -a 256 -c SHA256SUMS.txt; fi'],
        { cwd: pkg, stdio: 'pipe' },
      );
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  });

  it('rejects internal artifacts inside the package', () => {
    const fakeRoot = mkdtempSync(join(tmpdir(), 'csbot-root-'));
    try {
      for (const dir of ['deploy/nginx', 'config', 'apps/adapter/src']) {
        mkdirSync(join(fakeRoot, dir), { recursive: true });
      }
      for (const rel of [
        'deploy/docker-compose.yml',
        'deploy/nginx/nginx.conf',
        'deploy/nginx/fastgpt-admin-allow.conf',
        'deploy/init-perms.sh',
        'deploy/install.sh',
        'deploy/collect-logs.sh',
        'deploy/init-control-db.sh',
        'deploy/backup.sh',
        'deploy/logrotate.conf',
        '.env.template',
        'config/keywords.yml',
      ]) {
        writeFileSync(join(fakeRoot, rel), 'x\n');
      }
      writeFileSync(join(fakeRoot, 'config/leak.pem'), 'PRIVATE KEY\n');

      let status = 0;
      let stderr = '';
      try {
        runPackage({ ROOT_DIR: fakeRoot, VERSION: '1.0.0', OUT_DIR: join(fakeRoot, 'out') });
      } catch (err) {
        const e = err as { status?: number; stderr?: Buffer | string };
        status = e.status ?? 1;
        stderr = String(e.stderr ?? '');
      }
      expect(status).not.toBe(0);
      expect(stderr).toContain('config/leak.pem');
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
    }
  });
});
