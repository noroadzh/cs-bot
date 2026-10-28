/**
 * 未配对消息池：查询与人工补配
 */
import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';
import type { SensitiveRedactor } from './sensitive-redactor.js';
import type { ImportBlacklist } from './import-blacklist.js';
import { computeSessionHash, computeSourceHash } from './import-hash.js';
import { mapItem } from './import-mappers.js';
import type { ImportItem } from './import-job.entity.js';

export interface UnpairedDeps {
  pool: Pool;
  redactor: SensitiveRedactor;
  blacklist: ImportBlacklist;
}

export async function listUnpaired(
  pool: Pool,
  jobId: string,
  limit = 50,
  offset = 0,
): Promise<{ total: number; limit: number; offset: number; rows: unknown[] }> {
  const lim = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const off = Math.max(Math.trunc(offset), 0);
  const [page, count] = await Promise.all([
    pool.query(
      `SELECT id, conversation_id, sender_id, content, occurred_at
         FROM import_unpaired WHERE job_id = $1
        ORDER BY conversation_id, occurred_at, id LIMIT $2 OFFSET $3`,
      [jobId, lim, off],
    ),
    pool.query('SELECT COUNT(*)::int AS n FROM import_unpaired WHERE job_id = $1', [jobId]),
  ]);
  return { total: Number(count.rows[0]?.n ?? 0), limit: lim, offset: off, rows: page.rows };
}

export async function pairUnpaired(
  deps: UnpairedDeps,
  jobId: string,
  customerMessageId: string,
  serviceMessageId: string,
): Promise<ImportItem> {
  const client = await deps.pool.connect();
  try {
    await client.query('BEGIN');
    const rows = await client.query(
      `SELECT * FROM import_unpaired
        WHERE job_id = $1 AND id = ANY($2::uuid[])
        FOR UPDATE`,
      [jobId, [customerMessageId, serviceMessageId]],
    );
    const byId = new Map(rows.rows.map((r) => [String(r.id), r]));
    const customer = byId.get(customerMessageId);
    const service = byId.get(serviceMessageId);
    if (!customer || !service) {
      throw new HttpException(
        { errCode: 'IMPORT_UNPAIRED_NOT_FOUND', detail: 'one or both messages are not in this job pool' },
        HttpStatus.NOT_FOUND,
      );
    }
    const question = String(customer.content);
    const answer = String(service.content);
    const red = deps.redactor.redact(answer);
    const sourceHash = computeSourceHash(question, red.text);
    const sessionHash = computeSessionHash(customer.conversation_id == null ? null : String(customer.conversation_id));
    const occurredAt = customer.occurred_at ? new Date(customer.occurred_at as string).toISOString() : null;
    const autoBlocked = deps.blacklist.matches(`${question} ${answer}`);
    const inserted = await client.query(
      `INSERT INTO import_item
         (id, job_id, question, answer_raw, answer_redacted, sensitive_flags,
          review_status, auto_blocked, suggest_action, source_hash, session_hash, occurred_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,'keep',$8,$9,$10,NOW())
       ON CONFLICT (source_hash) WHERE source_hash IS NOT NULL DO NOTHING
       RETURNING *`,
      [randomUUID(), jobId, question, answer, red.text, JSON.stringify(red.flags), autoBlocked, sourceHash, sessionHash, occurredAt],
    );
    if (inserted.rows.length === 0) {
      throw new HttpException(
        { errCode: 'IMPORT_DUPLICATE_ITEM', detail: 'the paired answer already exists' },
        HttpStatus.CONFLICT,
      );
    }
    await client.query('DELETE FROM import_unpaired WHERE job_id = $1 AND id = ANY($2::uuid[])', [
      jobId,
      [customerMessageId, serviceMessageId],
    ]);
    await client.query(
      `UPDATE import_job
          SET paired_count = paired_count + 1,
              unpaired_count = GREATEST(unpaired_count - 2, 0),
              item_count = item_count + 1,
              updated_at = NOW()
        WHERE id = $1`,
      [jobId],
    );
    await client.query('COMMIT');
    return mapItem(inserted.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
