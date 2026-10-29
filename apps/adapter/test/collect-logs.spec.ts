/**
 * 排障日志收集脚本：语法、可执行、dry-run 不落盘
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const SCRIPT = join(ROOT, 'deploy', 'collect-logs.sh');

let outDir: string;

beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), 'csbot-logs-'));
});
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe('deploy/collect-logs.sh', () => {
  it('passes bash syntax check and is executable', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT], { stdio: 'pipe' })).not.toThrow();
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it('--dry-run lists what will be collected without writing a bundle', () => {
    const stdout = execFileSync('bash', [SCRIPT, '--dry-run', '--out', outDir], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    expect(stdout).toContain('logs-bundle');
    expect(stdout).toContain('logs --no-color --timestamps');
    expect(stdout).toContain('adapter');
    expect(readdirSync(outDir)).toEqual([]);
  });
});
