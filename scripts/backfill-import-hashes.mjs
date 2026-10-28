#!/usr/bin/env node
/**
 * 回填 import_item.source_hash（历史数据一次性迁移）
 *
 * 用法：DATABASE_URL=postgresql://... node scripts/backfill-import-hashes.mjs [--batch 500]
 *
 * - 只处理 source_hash IS NULL 且正文仍在的条目
 * - 已存在相同哈希的行保持 NULL（避免唯一索引冲突，历史重复不追溯）
 * - 正文已清空的 rejected 条目无法回填，保持 NULL
 */
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(new URL('../apps/adapter/package.json', import.meta.url));
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[backfill] DATABASE_URL is required');
  process.exit(1);
}
const batchArg = process.argv.indexOf('--batch');
const batchSize = batchArg > -1 ? Number(process.argv[batchArg + 1]) : 500;

const normalize = (s) => String(s).normalize('NFKC').trim().replace(/\s+/g, ' ');
const sourceHash = (q, a) =>
  createHash('sha256').update(`${normalize(q)}\n${normalize(a)}`).digest('hex');

const client = new Client({ connectionString: url });
await client.connect();
let updated = 0;
let skipped = 0;
try {
  for (;;) {
    const res = await client.query(
      `SELECT id, question, answer_redacted, answer_raw
         FROM import_item
        WHERE source_hash IS NULL
          AND COALESCE(answer_redacted, answer_raw) IS NOT NULL
        ORDER BY created_at ASC
        LIMIT $1`,
      [batchSize],
    );
    if (res.rows.length === 0) break;
    for (const row of res.rows) {
      const answer = row.answer_redacted ?? row.answer_raw ?? '';
      const hash = sourceHash(row.question ?? '', answer);
      const r = await client.query(
        `UPDATE import_item i SET source_hash = $2
          WHERE i.id = $1
            AND NOT EXISTS (SELECT 1 FROM import_item x WHERE x.source_hash = $2)`,
        [row.id, hash],
      );
      if (r.rowCount === 1) updated += 1;
      else skipped += 1;
    }
    console.log(`[backfill] batch=${res.rows.length} updated=${updated} skipped=${skipped}`);
  }
  console.log(`[backfill] done updated=${updated} skipped=${skipped}`);
} finally {
  await client.end();
}
