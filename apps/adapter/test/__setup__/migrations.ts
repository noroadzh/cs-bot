/**
 * 测试共用：按序号执行 src/**\/*.sql（幂等，重复 DDL 错误忽略）
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

export async function applyMigrations(pool: Pool): Promise<void> {
  const src = join(process.cwd(), 'src');
  const files: { seq: string; path: string }[] = [];
  for (const dir of readdirSync(src, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of readdirSync(join(src, dir.name))) {
      const m = /^(\d{3})-.*\.sql$/.exec(f);
      if (m) files.push({ seq: m[1], path: join(src, dir.name, f) });
    }
  }
  files.sort((a, b) => a.seq.localeCompare(b.seq));
  for (const { path } of files) {
    try {
      await pool.query(readFileSync(path, 'utf8'));
    } catch (err) {
      if (/already exists|duplicate/i.test((err as Error).message)) continue;
      throw err;
    }
  }
}
