/**
 * review.xlsx 生成与 30 天保留期校验
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppLogger } from '../common/logger.js';
import { buildReviewManifest, type ManifestRow } from './review-manifest.js';

export const MANIFEST_RETENTION_MS = 30 * 86_400_000;

const logger = new AppLogger('ImportManifest');

export async function buildJobManifest(
  pool: Pick<Pool, 'query'>,
  jobId: string,
  nowMs = Date.now(),
): Promise<Buffer> {
  const jobRes = await pool.query(
    'SELECT id, manifest_generated_at FROM import_job WHERE id = $1',
    [jobId],
  );
  if (jobRes.rows.length === 0) {
    throw new HttpException(
      { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
      HttpStatus.NOT_FOUND,
    );
  }
  const generatedAt = jobRes.rows[0].manifest_generated_at;
  if (generatedAt && nowMs - new Date(generatedAt as string).getTime() > MANIFEST_RETENTION_MS) {
    throw new HttpException(
      {
        errCode: 'IMPORT_MANIFEST_EXPIRED',
        detail: 'review manifest retention (30 days) exceeded',
        generatedAt: new Date(generatedAt as string).toISOString(),
      },
      HttpStatus.GONE,
    );
  }
  if (!generatedAt) {
    await pool.query(
      'UPDATE import_job SET manifest_generated_at = NOW() WHERE id = $1 AND manifest_generated_at IS NULL',
      [jobId],
    );
  }

  const res = await pool.query(
    'SELECT * FROM import_item WHERE job_id = $1 ORDER BY created_at ASC, id ASC',
    [jobId],
  );
  const rows: ManifestRow[] = res.rows.map((r, i) => {
    const flags = Array.isArray(r.sensitive_flags) ? r.sensitive_flags : [];
    return {
      index: i + 1,
      conversationHash: r.session_hash == null ? '—' : String(r.session_hash).slice(0, 12),
      occurredAt: r.occurred_at == null ? '—' : new Date(r.occurred_at as string).toISOString(),
      question: r.question == null ? '' : String(r.question),
      answer: String(r.answer_redacted ?? ''),
      redacted: flags.length > 0,
      sensitive: flags.length > 0,
      similar: r.similar_qa_id != null,
      suggestAction: (r.suggest_action as string) ?? 'keep',
      reviewResult: r.review_status === 'pending' ? '' : String(r.review_status),
    };
  });
  const buf = await buildReviewManifest(rows);
  try {
    const dir = join(process.cwd(), 'data', 'import', jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, 'review.xlsx'), buf, { mode: 0o600 });
  } catch (err) {
    logger.warn({
      detail: 'review-manifest-persist-failed',
      jobId,
      err: (err as Error).message,
    });
  }
  return buf;
}
