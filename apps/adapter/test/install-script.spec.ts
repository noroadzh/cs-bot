/**
 * 一键部署脚本：语法、dry-run 不落盘、check 缺项失败
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'deploy', 'install.sh');
const STRONG_SECRETS = [
  'ADMIN_PASSWORD=Str0ng-Admin-Passw0rd',
  'POSTGRES_PASSWORD=Str0ng-Pg-Passw0rd',
  'FASTGPT_ROOT_PASSWORD=Str0ng-Fastgpt-Passw0rd',
];

let dir: string;

function fixture(withEnv: boolean, extraEnv: string[] = []): string {
  const root = mkdtempSync(join(dir, 'root-'));
  for (const d of ['deploy/nginx/certs', 'license']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'deploy/docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(root, 'deploy/init-perms.sh'), '#!/bin/sh\nexit 0\n');
  writeFileSync(join(root, 'deploy/nginx/certs/fullchain.pem'), 'CERT\n');
  writeFileSync(join(root, 'deploy/nginx/certs/privkey.pem'), 'KEY\n');
  writeFileSync(join(root, 'license/license.lic'), 'LIC\n');
  if (withEnv) {
    writeFileSync(
      join(root, '.env'),
      [
        'WECHAT_CORP_ID=ww1',
        'WECHAT_AGENT_ID=1000001',
        'WECHAT_AGENT_SECRET=s',
        'WECHAT_TOKEN=t',
        'WECHAT_ENCODING_AES_KEY=k',
        'FASTGPT_API_KEY=f',
        ...extraEnv,
      ].join('\n') + '\n',
    );
  }
  return root;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'csbot-install-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('deploy/install.sh', () => {
  it('passes bash syntax check', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });

  it('--dry-run prints the plan without creating directories', () => {
    const root = fixture(true, STRONG_SECRETS);
    const out = execFileSync('bash', [SCRIPT, '--dry-run'], {
      env: { ...process.env, ROOT_DIR: root },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).toContain('docker compose -f deploy/docker-compose.yml up -d');
    expect(out).toContain('/healthz');
    expect(out).toContain('fastgpt-admin-allow.conf');
    expect(existsSync(join(root, 'data'))).toBe(false);
    expect(existsSync(join(root, 'logs'))).toBe(false);
  });

  it('--check rejects a checksum mismatch and names the file', () => {
    const root = fixture(true, STRONG_SECRETS);
    const sums = '0000000000000000000000000000000000000000000000000000000000000000  deploy/docker-compose.yml\n';
    writeFileSync(join(root, 'SHA256SUMS.txt'), sums);

    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', [SCRIPT, '--check'], {
        env: { ...process.env, ROOT_DIR: root },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = String(e.stderr ?? '');
    }
    expect(status).not.toBe(0);
    expect(stderr).toContain('完整性校验失败');
    expect(stderr).toContain('deploy/docker-compose.yml');
  });

  it('--check rejects weak administrative secrets', () => {
    const root = fixture(true, [
      'ADMIN_PASSWORD=please_change_me',
      'POSTGRES_PASSWORD=cs',
      'FASTGPT_ROOT_PASSWORD=fastgpt123456',
    ]);

    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', [SCRIPT, '--check'], {
        env: { ...process.env, ROOT_DIR: root },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = String(e.stderr ?? '');
    }
    expect(status).not.toBe(0);
    expect(stderr).toContain('ADMIN_PASSWORD');
    expect(stderr).toContain('POSTGRES_PASSWORD');
    expect(stderr).toContain('FASTGPT_ROOT_PASSWORD');
    expect(stderr).toContain('默认/常见值');
  });

  it('--dry-run passes with strong secrets and no checksum file', () => {
    const root = fixture(true, STRONG_SECRETS);
    const out = execFileSync('bash', [SCRIPT, '--dry-run'], {
      env: { ...process.env, ROOT_DIR: root },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).toContain('docker compose -f deploy/docker-compose.yml up -d');
    expect(out).not.toContain('openssl rand');
  });

  it('--check fails and names missing .env', () => {
    const root = fixture(false);
    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', [SCRIPT, '--check'], {
        env: { ...process.env, ROOT_DIR: root },
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = String(e.stderr ?? '');
    }
    expect(status).not.toBe(0);
    expect(stderr).toContain('.env');
  });
});
