/**
 * 不含镜像的安装包：安装脚本、构建脚本、配置，且无镜像 tar / 私钥
 */
import { describe, it, expect, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'package-install.sh');
const outDir = mkdtempSync(join(tmpdir(), 'csbot-install-'));

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe('package-install', () => {
  it('packs install and build scripts with configs and no images', () => {
    execFileSync('bash', [SCRIPT], {
      env: { ...process.env, VERSION: '9.9.9', OUT_DIR: outDir },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const tar = join(outDir, 'cs-bot-install-9.9.9.tar.gz');
    const list = execFileSync('tar', ['-tzf', tar], { encoding: 'utf8' });

    expect(list).toContain('cs-bot-install-9.9.9/deploy/install.sh');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/setup.sh');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/issue-letsencrypt.sh');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/build-images.sh');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/docker-compose.yml');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/Dockerfile.adapter');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/nginx/nginx.conf');
    expect(list).toContain('cs-bot-install-9.9.9/deploy/nginx/fastgpt-admin-allow.conf');
    expect(list).toContain('cs-bot-install-9.9.9/.env.template');
    expect(list).toContain('cs-bot-install-9.9.9/config/keywords.yml');
    expect(list).toContain('cs-bot-install-9.9.9/pnpm-lock.yaml');
    expect(list).not.toContain('images/');
    expect(list).not.toMatch(/\.tar$/m);
    expect(list).not.toMatch(/\.pem$/m);
    expect(list).not.toContain('docker-compose.saas.yml');
    expect(list).not.toContain('license/license.lic');

    const extractDir = mkdtempSync(join(tmpdir(), 'csbot-install-x-'));
    try {
      execFileSync('tar', ['-xzf', tar, '-C', extractDir]);
      execFileSync(
        'bash',
        ['-lc', 'if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS.txt; else shasum -a 256 -c SHA256SUMS.txt; fi'],
        { cwd: join(extractDir, 'cs-bot-install-9.9.9'), stdio: 'pipe' },
      );
    } finally {
      rmSync(extractDir, { recursive: true, force: true });
    }
  });
});
