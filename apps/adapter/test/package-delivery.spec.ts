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
    const list = execFileSync('tar', ['-tzf', tar], {
      encoding: 'utf8',
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });

    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/docker-compose.yml');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/Dockerfile.adapter');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/build-images.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/nginx/nginx.conf');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/nginx/fastgpt-admin-allow.conf');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/install.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/setup.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/issue-letsencrypt.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/render-admin-allow.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/deploy/collect-logs.sh');
    expect(list).toContain('cs-bot-deploy-9.9.9/.env.template');
    expect(list).toContain('cs-bot-deploy-9.9.9/使用说明.md');
    expect(list).toContain('cs-bot-deploy-9.9.9/docs/03-交付实施/部署包使用说明.md');
    expect(list).toContain('cs-bot-deploy-9.9.9/docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md');
    expect(list).toContain('cs-bot-deploy-9.9.9/docs/03-交付实施/用户使用手册-私有化版.md');
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
      for (const dir of ['deploy/nginx', 'config', 'apps/adapter/src', 'docs/03-交付实施']) {
        mkdirSync(join(fakeRoot, dir), { recursive: true });
      }
      for (const rel of [
        'deploy/docker-compose.yml',
        'deploy/Dockerfile.adapter',
        'deploy/build-images.sh',
        'deploy/nginx/nginx.conf',
        'deploy/nginx/fastgpt-admin-allow.conf',
        'deploy/init-perms.sh',
        'deploy/install.sh',
        'deploy/setup.sh',
        'deploy/issue-letsencrypt.sh',
        'deploy/renew-wildcard-acme-dns01.sh',
        'deploy/render-admin-allow.sh',
        'deploy/collect-logs.sh',
        'deploy/init-control-db.sh',
        'deploy/backup.sh',
        'deploy/logrotate.conf',
        '.env.template',
        'docs/03-交付实施/部署包使用说明.md',
        'docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md',
        'docs/03-交付实施/用户使用手册-私有化版.md',
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
