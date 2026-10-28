/**
 * 导入条目持久化、去重与阶段计数
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { SensitiveRedactor } from './sensitive-redactor.js';
import type { ImportBlacklist } from './import-blacklist.js';
import { DEFAULT_SIMILAR_THRESHOLD, type FastGptSearchClient } from './near-duplicate.js';
import { computeSessionHash, computeSourceHash } from './import-hash.js';
import type { CleanMessage } from './import-cleaner.js';
import { affectedCount } from './import-mappers.js';

export interface DedupeDeps {
  pool: Pool;
  redactor: SensitiveRedactor;
  blacklist: ImportBlacklist;
  search: FastGptSearchClient;
  guardMemory(): Promise<void>;
}

export async function persistItems(
  deps: DedupeDeps,
  jobId: string,
  rows: readonly {
    question: string;
    answer: string;
    conversationId?: string;
    occurredAt?: number;
  }[],
): Promise<{ inserted: number; dedup: number }> {
  const { pool, redactor, blacklist, search } = deps;
  const prepared: {
    question: string;
    answer: string;
    redText: string;
    flags: string[];
    autoBlocked: boolean;
    similarId: string | null;
    suggest: string;
    sourceHash: string;
    sessionHash: string | null;
    occurredAt: string | null;
  }[] = [];
  let processed = 0;
  for (const row of rows) {
    if (processed > 0 && processed % 2000 === 0) await deps.guardMemory();
    processed += 1;
    const red = redactor.redact(row.answer);
    const autoBlocked = blacklist.matches(`${row.question} ${row.answer}`);
    let similarId: string | null = null;
    if (!autoBlocked) {
      const hit = await search.search(row.question);
      if (hit && hit.score >= DEFAULT_SIMILAR_THRESHOLD) similarId = hit.id || null;
    }
    prepared.push({
      question: row.question,
      answer: row.answer,
      redText: red.text,
      flags: red.flags,
      autoBlocked,
      similarId,
      suggest: similarId ? 'discard' : 'keep',
      sourceHash: computeSourceHash(row.question, red.text),
      sessionHash: computeSessionHash(row.conversationId),
      occurredAt: row.occurredAt === undefined ? null : new Date(row.occurredAt).toISOString(),
    });
  }

  const masked = prepared.filter((p) => p.flags.length > 0).length;
  const blocked = prepared.filter((p) => p.autoBlocked).length;
  const seen = new Set<string>();
  let inserted = 0;
  let dedup = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date().toISOString();
    for (const p of prepared) {
      if (seen.has(p.sourceHash)) {
        dedup += 1;
        continue;
      }
      seen.add(p.sourceHash);
      const res = await client.query(
        `INSERT INTO import_item
           (id, job_id, question, answer_raw, answer_redacted, sensitive_flags,
            review_status, auto_blocked, similar_qa_id, suggest_action,
            source_hash, session_hash, occurred_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (source_hash) WHERE source_hash IS NOT NULL DO NOTHING
         RETURNING id`,
        [
          randomUUID(), jobId, p.question, p.answer,
          p.redText, JSON.stringify(p.flags),
          p.autoBlocked, p.similarId, p.suggest,
          p.sourceHash, p.sessionHash, p.occurredAt, now,
        ],
      );
      if (affectedCount(res) === 0) dedup += 1;
      else inserted += 1;
    }
    await client.query(
      `UPDATE import_job
          SET masked_count = masked_count + $2,
              blocked_count = blocked_count + $3,
              dedup_count = dedup_count + $4,
              updated_at = $5
        WHERE id = $1`,
      [jobId, masked, blocked, dedup, now],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return { inserted, dedup };
}

export async function persistUnpaired(
  pool: Pool,
  jobId: string,
  messages: readonly CleanMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of messages) {
      await client.query(
        `INSERT INTO import_unpaired (id, job_id, conversation_id, sender_id, content, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), jobId, m.conversationId, m.senderId, m.content, new Date(m.occurredAt).toISOString()],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function updateStageCounts(
  pool: Pool,
  jobId: string,
  totalMessages: number,
  cleaned: number,
  paired: number,
  unpaired: number,
): Promise<void> {
  await pool.query(
    `UPDATE import_job
        SET total_msgs = $2, parsed_msgs = $3, cleaned_count = $4,
            paired_count = $5, unpaired_count = $6, updated_at = $7
      WHERE id = $1`,
    [jobId, totalMessages, cleaned, cleaned, paired, unpaired, new Date().toISOString()],
  );
}

export async function updateMessageCounters(
  pool: Pool,
  jobId: string,
  totalMessages: number,
  parsedMessages: number,
): Promise<void> {
  await pool.query(
    `UPDATE import_job SET total_msgs = $2, parsed_msgs = $3, updated_at = $4 WHERE id = $1`,
    [jobId, totalMessages, parsedMessages, new Date().toISOString()],
  );
}

export async function refreshImportCounters(pool: Pool, jobId: string): Promise<void> {
  const res = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE review_status IN ('approved', 'modified'))::int AS approved,
       COUNT(*) FILTER (WHERE review_status IN ('approved', 'modified') AND auto_blocked = false)::int AS importable,
       COUNT(*) FILTER (WHERE imported_qa_id IS NOT NULL)::int AS imported
     FROM import_item WHERE job_id = $1`,
    [jobId],
  );
  const approved = Number(res.rows[0]?.approved ?? 0);
  const importable = Number(res.rows[0]?.importable ?? 0);
  const imported = Number(res.rows[0]?.imported ?? 0);
  await pool.query(
    `UPDATE import_job
        SET approved_count = $2, imported_count = $3,
            failed_count = GREATEST($4::int - $3::int, 0), updated_at = $5
      WHERE id = $1`,
    [jobId, approved, imported, importable, new Date().toISOString()],
  );
}

export async function countStoredItems(pool: Pool, jobId: string): Promise<number> {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS n FROM import_item WHERE job_id = $1`,
    [jobId],
  );
  return Number(res.rows[0]?.n ?? 0);
}
