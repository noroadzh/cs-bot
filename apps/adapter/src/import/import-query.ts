/**
 * 导入任务查询/列表/删除（只读与清理）
 */
import { promises as fs } from 'fs';
import { join } from 'node:path';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppLogger } from '../common/logger.js';
import {
  clamp,
  emptyStatusCounts,
  isDeletable,
  mapItem,
  mapJob,
  mapJobRow,
  toJobDto,
} from './import-mappers.js';
import type {
  ImportItem,
  ImportItemListQuery,
  ImportJob,
  ImportJobDetail,
  ImportJobListQuery,
  ImportJobRow,
  ImportJobStatus,
  ReviewStatus,
} from './import-job.entity.js';

const logger = new AppLogger('ImportQuery');

export async function getJob(pool: Pool, jobId: string): Promise<ImportJob | null> {
  const res = await pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
  return res.rows.length === 0 ? null : mapJob(res.rows[0]);
}

export async function getJobRow(pool: Pool, jobId: string): Promise<ImportJobRow | null> {
  const res = await pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
  if (res.rows.length === 0) return null;
  return mapJobRow(res.rows[0]);
}

export async function listJobs(
  pool: Pool,
  opts: ImportJobListQuery = {},
): Promise<{ items: ImportJob[]; total: number; limit: number; offset: number }> {
  const limit = clamp(opts.limit ?? 50, 1, 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const status = opts.status === undefined ? null : opts.status;

  const where = status === null ? '' : 'WHERE status = $3';
  const params = status === null ? [limit, offset] : [limit, offset, status];

  const [page, count] = await Promise.all([
    pool.query(
      `SELECT * FROM import_job ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      params,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM import_job ${status === null ? '' : 'WHERE status = $1'}`,
      status === null ? [] : [status],
    ),
  ]);
  return {
    items: page.rows.map((r) => toJobDto(mapJobRow(r))),
    total: Number(count.rows[0]?.n ?? 0),
    limit,
    offset,
  };
}

export async function countJobsByStatus(pool: Pool): Promise<Record<ImportJobStatus, number>> {
  const out = emptyStatusCounts();
  const res = await pool.query('SELECT status, COUNT(*)::int AS n FROM import_job GROUP BY status');
  for (const r of res.rows) {
    const status = String(r.status) as ImportJobStatus;
    if (status in out) out[status] = Number(r.n);
  }
  return out;
}

export async function listItems(
  pool: Pool,
  jobId: string,
  opts: ImportItemListQuery = {},
): Promise<{ items: ImportItem[]; total: number; limit: number; offset: number }> {
  const limit = clamp(opts.limit ?? 50, 1, 200);
  const offset = Math.max(0, opts.offset ?? 0);
  const filters: string[] = ['job_id = $1'];
  const params: unknown[] = [jobId];
  if (opts.reviewStatus !== undefined) {
    params.push(opts.reviewStatus);
    filters.push(`review_status = $${params.length}`);
  }
  if (opts.sensitive !== undefined) {
    filters.push(
      opts.sensitive
        ? "jsonb_array_length(sensitive_flags) > 0"
        : "jsonb_array_length(sensitive_flags) = 0",
    );
  }
  const where = filters.join(' AND ');
  const [page, count] = await Promise.all([
    pool.query(
      `SELECT * FROM import_item WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    pool.query(`SELECT COUNT(*)::int AS n FROM import_item WHERE ${where}`, params),
  ]);
  return {
    items: page.rows.map((r) => mapItem(r)),
    total: Number(count.rows[0]?.n ?? 0),
    limit,
    offset,
  };
}

export async function countItemsByStatus(
  pool: Pool,
  jobId: string,
): Promise<Record<ReviewStatus, number>> {
  const res = await pool.query(
    `SELECT review_status, COUNT(*)::int AS n FROM import_item
      WHERE job_id = $1 GROUP BY review_status`,
    [jobId],
  );
  const out: Record<ReviewStatus, number> = {
    pending: 0, approved: 0, modified: 0, rejected: 0, 'needs-fix': 0,
  };
  for (const r of res.rows) {
    const key = r.review_status as ReviewStatus;
    if (key in out) out[key] = Number(r.n);
  }
  return out;
}

export async function getJobDetail(pool: Pool, jobId: string): Promise<ImportJobDetail | null> {
  const job = await getJob(pool, jobId);
  if (job === null) return null;
  return {
    job,
    itemCounts: await countItemsByStatus(pool, jobId),
    deletable: isDeletable(job.status),
  };
}

export async function deleteJob(pool: Pool, jobId: string): Promise<{ deletedItems: number }> {
  const job = await getJob(pool, jobId);
  if (job === null) {
    throw new HttpException(
      { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
      HttpStatus.NOT_FOUND,
    );
  }
  if (!isDeletable(job.status)) {
    throw new HttpException(
      {
        errCode: 'IMPORT_NOT_DELETABLE',
        detail: `import job is ${job.status}, already applied to knowledge base`,
        status: job.status,
      },
      HttpStatus.CONFLICT,
    );
  }
  const before = await countItemsByStatus(pool, jobId);
  const deletedItems = Object.values(before).reduce((a, b) => a + b, 0);
  await pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);
  const after = await countItemsByStatus(pool, jobId);
  const leftover = Object.values(after).reduce((a, b) => a + b, 0);
  if (leftover !== 0) {
    throw new HttpException(
      {
        errCode: 'IMPORT_DELETE_INCOMPLETE',
        detail: `${leftover} import items survived job deletion (missing ON DELETE CASCADE)`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
  try {
    await fs.rm(join(process.cwd(), 'data', 'import', jobId), { recursive: true, force: true });
  } catch (err) {
    logger.warn({ detail: 'import-file-cleanup-failed', jobId, err: (err as Error).message });
  }
  logger.log({ detail: 'import-deleted', jobId, items: deletedItems });
  return { deletedItems };
}
