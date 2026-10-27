/**
 * 部署迁移一致性：每个 src/**\/NNN-*.sql 都必须被 compose 与 Dockerfile 引用
 */
import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), '..', '..');

function migrationFiles(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) migrationFiles(p, acc);
    else if (/^\d{3}-.*\.sql$/.test(e.name)) acc.push(p);
  }
  return acc;
}

describe('deploy migrations', () => {
  const files = migrationFiles(join(process.cwd(), 'src')).sort();
  const compose = readFileSync(join(ROOT, 'deploy', 'docker-compose.yml'), 'utf8');
  const dockerfile = readFileSync(join(ROOT, 'deploy', 'Dockerfile.adapter'), 'utf8');

  it('至少包含 9 个迁移', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  for (const f of files) {
    const rel = relative(ROOT, f);
    it(`compose 引用 ${rel}`, () => expect(compose).toContain(rel));
    it(`Dockerfile 引用 ${rel}`, () => expect(dockerfile).toContain(rel));
  }
});
