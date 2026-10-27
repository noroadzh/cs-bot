/**
 * 交付加固：构建无 sourcemap、镜像混淆步骤、无 --enable-source-maps
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');
const dockerfile = readFileSync(join(ROOT, 'deploy', 'Dockerfile.adapter'), 'utf8');

describe('release hardening', () => {
  it('Dockerfile 启用混淆并剔除 sourcemap', () => {
    expect(dockerfile).toContain('javascript-obfuscator@4.1.1');
    expect(dockerfile).toContain("find apps/adapter/dist packages/shared/dist node_modules -name '*.map' -delete");
    expect(dockerfile).toContain("-name '*.d.ts' -delete");
  });

  it('运行时不再 --enable-source-maps', () => {
    expect(dockerfile).not.toContain('--enable-source-maps');
  });

  it('构建产物无 .map（若已 build）', () => {
    const dist = join(process.cwd(), 'dist');
    if (!existsSync(dist)) return; // 未构建时跳过；CI 在 build 后执行
    const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
    const out = execFileSync('find', [dist, '-name', '*.map'], { encoding: 'utf8' }).trim();
    expect(out).toBe('');
  });
});
