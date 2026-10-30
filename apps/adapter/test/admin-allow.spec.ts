/**
 * FastGPT 管理后台白名单渲染：默认 deny、CIDR allow、非法值拒绝
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'deploy', 'render-admin-allow.sh');
const target = (root: string) => join(root, 'deploy', 'nginx', 'fastgpt-admin-allow.conf');

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'csbot-allow-')); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (root: string, arg?: string) =>
  execFileSync('bash', arg === undefined ? [SCRIPT] : [SCRIPT, arg], {
    env: { ...process.env, ROOT_DIR: root },
    encoding: 'utf8',
    stdio: 'pipe',
  });

const root = () => {
  const r = mkdtempSync(join(dir, 'r-'));
  mkdirSync(join(r, 'deploy', 'nginx'), { recursive: true });
  return r;
};

describe('render-admin-allow.sh', () => {
  it('defaults to deny all', () => {
    const r = root();
    run(r, '');
    const body = readFileSync(target(r), 'utf8');
    expect(body).toContain('deny all;');
    expect(body).not.toContain('allow ');
  });

  it('writes allow lines for configured CIDRs', () => {
    const r = root();
    run(r, '10.0.0.0/8,203.0.113.5');
    const body = readFileSync(target(r), 'utf8');
    expect(body).toContain('allow 10.0.0.0/8;');
    expect(body).toContain('allow 203.0.113.5;');
    expect(body.trimEnd().endsWith('deny all;')).toBe(true);
  });

  it('reads FASTGPT_ADMIN_ALLOW_CIDRS from .env when no argument', () => {
    const r = root();
    writeFileSync(join(r, '.env'), 'FASTGPT_ADMIN_ALLOW_CIDRS=192.168.0.0/16\n');
    run(r);
    expect(readFileSync(target(r), 'utf8')).toContain('allow 192.168.0.0/16;');
  });

  it('rejects invalid entries', () => {
    const r = root();
    let status = 0;
    try {
      run(r, 'not-a-cidr,evil');
    } catch (err) {
      status = (err as { status?: number }).status ?? 1;
    }
    expect(status).not.toBe(0);
  });
});
