/**
 * 分步部署向导：只打印说明时不写文件，非终端不能进入提问
 */
import { describe, it, expect } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'deploy', 'setup.sh');

describe('deploy/setup.sh', () => {
  it('passes bash syntax check', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });

  it('--steps explains parameters and the WeCom callback without writing .env', () => {
    const root = mkdtempSync(join(tmpdir(), 'csbot-setup-'));
    const out = execFileSync('bash', [SCRIPT, '--steps'], {
      env: { ...process.env, ROOT_DIR: root },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(out).toContain('步骤 1/8');
    expect(out).toContain('步骤 8/8');
    expect(out).toContain('作用');
    expect(out).toContain('影响');
    expect(out).toContain('WECHAT_ENCODING_AES_KEY');
    expect(out).toContain('43');
    expect(out).toContain('/wecom/callback');
    expect(out).toContain('POSTGRES_PASSWORD');
    expect(out).toContain('up -d adapter');
    expect(out).toContain("Let's Encrypt");
    expect(out).toContain('issue-letsencrypt.sh');
    expect(existsSync(join(root, '.env'))).toBe(false);
  });

  it('refuses the wizard when stdin is not a terminal', () => {
    let status = 0;
    let stderr = '';
    try {
      execFileSync('bash', [SCRIPT], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = String(e.stderr ?? '');
    }
    expect(status).not.toBe(0);
    expect(stderr).toContain('终端');
  });
});
