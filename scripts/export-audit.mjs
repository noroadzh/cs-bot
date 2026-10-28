#!/usr/bin/env node
/**
 * 导出平台审计日志（异地留存用）：DATABASE_URL=... node scripts/export-audit.mjs [path]
 * 只读导出 JSONL，不删除任何行。
 */
import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';

const require = createRequire(new URL('../apps/adapter/package.json', import.meta.url));
const { Client } = require('pg');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[audit-export] DATABASE_URL is required');
  process.exit(1);
}
const outPath = process.argv[2] ?? `audit-${new Date().toISOString().slice(0, 10)}.jsonl`;
const client = new Client({ connectionString: url });
await client.connect();
const out = createWriteStream(outPath, { mode: 0o600 });
try {
  const res = await client.query(
    `SELECT seq, tenant_id, action, actor, payload, prev_hash, hash, created_at
       FROM platform_audit_log ORDER BY seq ASC`,
  );
  for (const row of res.rows) out.write(`${JSON.stringify(row)}\n`);
  console.log(`[audit-export] wrote ${res.rows.length} entries to ${outPath}`);
} finally {
  out.end();
  await client.end();
}
