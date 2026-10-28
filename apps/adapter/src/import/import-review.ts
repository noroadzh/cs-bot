/**
 * 导入条目审核流转与语料同步
 */
import type { Pool, PoolClient } from 'pg';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { AppLogger } from '../common/logger.js';
import type { SensitiveRedactor } from './sensitive-redactor.js';
import { affectedCount, aggregateStatus, mapItem } from './import-mappers.js';
import { computeSourceHash } from './import-hash.js';
import { randomUUID } from 'node:crypto';
import type {
  ImportItem,
  ImportJobStatus,
  ReviewStatus,
} from './import-job.entity.js';

export interface ReviewHost {
  pool: Pool;
  redactor: SensitiveRedactor;
  logger: AppLogger;
  countItemsByStatus(jobId: string): Promise<Record<ReviewStatus, number>>;
  updateStatusUnlessRolledBack(jobId: string, status: string): Promise<void>;
  updateStatusInTxUnlessRolledBack(client: PoolClient, jobId: string, status: string): Promise<void>;
}

const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  pending:    ['pending', 'approved', 'modified', 'rejected', 'needs-fix'],
  approved:   ['approved', 'modified', 'rejected', 'needs-fix'],
  modified:   ['approved', 'modified', 'rejected', 'needs-fix'],
  rejected:   ['pending', 'approved', 'modified', 'rejected', 'needs-fix'],
  'needs-fix': ['approved', 'modified', 'rejected'],
};

export async function reviewItem(
  host: ReviewHost,
  jobId: string,
  itemId: string,
    patch: { reviewStatus: ReviewStatus; note?: string; question?: string; answer?: string },
  ): Promise<ImportItem> {
    const client = await host.pool.connect();
    let item: ImportItem;
    try {
      await client.query('BEGIN');

      // FOR UPDATE：并发 PATCH 同一条时串行化，避免两边都看到 pending 再各自转移
      const current = await client.query(
        'SELECT * FROM import_item WHERE id = $1 AND job_id = $2 FOR UPDATE',
        [itemId, jobId],
      );
      if (current.rows.length === 0) {
        throw new HttpException(
          { errCode: 'IMPORT_ITEM_NOT_FOUND', detail: `import item ${itemId} not found in job ${jobId}` },
          HttpStatus.NOT_FOUND,
        );
      }

      const from = current.rows[0].review_status as ReviewStatus;
      const to = patch.reviewStatus;
      if (!REVIEW_TRANSITIONS[from]?.includes(to)) {
        throw new HttpException(
          {
            errCode: 'IMPORT_REVIEW_TRANSITION_INVALID',
            detail: `cannot review item from ${from} to ${to}`,
            from,
            to,
            allowed: REVIEW_TRANSITIONS[from],
          },
          HttpStatus.CONFLICT,
        );
      }

      let nextQuestion: string | null = current.rows[0].question == null
        ? null
        : String(current.rows[0].question);
      let nextRaw: string | null = current.rows[0].answer_raw == null
        ? null
        : String(current.rows[0].answer_raw);
      let nextRedacted: string | null = current.rows[0].answer_redacted == null
        ? null
        : String(current.rows[0].answer_redacted);
      let nextHash: string | null = current.rows[0].source_hash == null
        ? null
        : String(current.rows[0].source_hash);

      if (to === 'modified') {
        if (!patch.answer || patch.answer.trim() === '') {
          throw new HttpException(
            { errCode: 'IMPORT_MODIFIED_ANSWER_REQUIRED', detail: 'answer is required for modified' },
            HttpStatus.BAD_REQUEST,
          );
        }
        if (patch.question !== undefined) nextQuestion = patch.question;
        nextRaw = patch.answer;
        nextRedacted = host.redactor.redact(patch.answer).text;
        nextHash = computeSourceHash(nextQuestion ?? '', nextRedacted ?? '');
      }

      let updated;
      try {
        updated = await client.query(
          `UPDATE import_item
              SET review_status = $3, reviewer_note = $4, reviewed_at = $5, updated_at = $5,
                  question = $6, answer_raw = $7, answer_redacted = $8, source_hash = $9
            WHERE id = $1 AND job_id = $2
            RETURNING *`,
          [
            itemId, jobId, to, patch.note ?? null, new Date().toISOString(),
            nextQuestion, nextRaw, nextRedacted, nextHash,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new HttpException(
            { errCode: 'IMPORT_DUPLICATE_ITEM', detail: 'revised item duplicates an existing pair' },
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      item = mapItem(updated.rows[0]);

      // 语料同步：approved/modified 可入库；离开可入库状态则移除
      const wasEligible = from === 'approved' || from === 'modified';
      const isEligible = to === 'approved' || to === 'modified';
      if (isEligible && (from !== to || to === 'modified')) {
        if (to === 'modified') {
          await client.query('DELETE FROM approved_qa WHERE source_item_id = $1', [itemId]);
        }
        await upsertApprovedQa(host, client, [
          { question: item.question, answer: item.answerRedacted, jobId, itemId },
        ]);
      } else if (wasEligible && !isEligible) {
        await client.query('DELETE FROM approved_qa WHERE source_item_id = $1', [itemId]);
      }

      await syncJobStatusInTx(host, client, jobId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    return item;
  }

  /**
   * 批量通过所有待审条目：pending + needs-fix，且未被标敏感。
   *
   * 返回三计数让前端能说清「批了多少、跳过多少、为什么跳过」：
   *   - skippedSensitive   敏感项，人工决定，不进批量
   *   - skippedNotPending  已有结论（approved/rejected），重复调用不重复处理 → 幂等
   *
   * job 状态必须是 parsed：终态任务里的条目已进知识库，再批会造成二次入库。
   */
export async function approveAll(
  host: ReviewHost,
  jobId: string,
): Promise<{ approved: number; skippedSensitive: number; skippedNotPending: number }> {
    const jobRes = await host.pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
    if (jobRes.rows.length === 0) {
      throw new HttpException(
        { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (jobRes.rows[0].status !== 'parsed') {
      throw new HttpException(
        {
          errCode: 'IMPORT_APPROVE_ALL_NOT_ALLOWED',
          detail: `import job is ${jobRes.rows[0].status}, approve-all only allowed on parsed`,
          status: jobRes.rows[0].status,
        },
        HttpStatus.CONFLICT,
      );
    }

    // 一次聚合出三计数，省掉三次往返
    const preRes = await host.pool.query(
      `SELECT COUNT(*) FILTER (
                WHERE review_status IN ('pending', 'needs-fix')
                  AND (sensitive_flags IS NULL OR jsonb_array_length(sensitive_flags) = 0)
              )::int AS approvable,
              COUNT(*) FILTER (
                WHERE review_status IN ('pending', 'needs-fix')
                  AND sensitive_flags IS NOT NULL
                  AND jsonb_array_length(sensitive_flags) > 0
              )::int AS skipped_sensitive,
              COUNT(*) FILTER (
                WHERE review_status NOT IN ('pending', 'needs-fix')
              )::int AS skipped_not_pending
        FROM import_item WHERE job_id = $1`,
      [jobId],
    );
    const pre = preRes.rows[0] ?? {};
    const skippedSensitive = Number(pre.skipped_sensitive ?? 0);
    const skippedNotPending = Number(pre.skipped_not_pending ?? 0);

    // UPDATE 与 approved_qa 写入必须同事务：批了一半而语料没进（或反过来）会让
    // 「job 报 approved 但检索不到」的账对不上。
    // RETURNING 直接带出 question/answer_redacted —— 语料要的正是这两列，
    // 再 SELECT 一次等于把刚写的数据读回来。
    const client = await host.pool.connect();
    let approved: number;
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE import_item
            SET review_status = 'approved', reviewer_note = NULL, reviewed_at = $2
          WHERE job_id = $1
            AND review_status IN ('pending', 'needs-fix')
            AND (sensitive_flags IS NULL OR jsonb_array_length(sensitive_flags) = 0)
          RETURNING id, question, answer_redacted`,
        [jobId, new Date().toISOString()],
      );
      // RETURNING id 时 affected = rows.length；驱动给了 rowCount/affectedRows 也认它
      approved = affectedCount(updated);

      await upsertApprovedQa(host, 
        client,
        updated.rows.map((r: Record<string, unknown>) => ({
          question: r.question as string,
          answer: r.answer_redacted as string,
          jobId,
          itemId: r.id as string,
        })),
      );

      await syncJobStatusInTx(host, client, jobId, { skipIfUnchanged: true });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    host.logger.log({
      detail: 'import-approve-all', jobId,
      approved, skippedSensitive, skippedNotPending,
    });
    return { approved, skippedSensitive, skippedNotPending };
  }

  // -------------------------------------------------------------------------
  // 内部
  // -------------------------------------------------------------------------

  /**
   * 重算 job 的聚合状态并回写。
   *
   * skipIfUnchanged：仍有 pending/needs-fix 时聚合结果就是 parsed，此时不发 UPDATE ——
   * approveAll 已在循环里处理过的任务多数落到这个分支，多一次空写没有意义。
   */
/**
   * 事务内版的 syncJobStatus：把聚合 SQL 跟 UPDATE 走同 client。
   * reviewItem / approveAll 在 BEGIN-COMMIT 之间调用，跨连接跑会读不到当前事务的 UPDATE。
   */
async function syncJobStatusInTx(
  host: ReviewHost,
  client: PoolClient,
  jobId: string,
    opts: { skipIfUnchanged?: boolean } = {},
  ): Promise<void> {
    const counts = await countItemsByStatusInTx(client, jobId);
    const status = aggregateStatus(counts);
    if (status === null) {
      if (!opts.skipIfUnchanged) await host.updateStatusInTxUnlessRolledBack(client, jobId, 'parsed');
      return;
    }
    await host.updateStatusInTxUnlessRolledBack(client, jobId, status);
  }

async function countItemsByStatusInTx(
  client: PoolClient,
    jobId: string,
  ): Promise<Record<ReviewStatus, number>> {
    const res = await client.query(
      `SELECT review_status, COUNT(*)::int AS n
         FROM import_item WHERE job_id = $1 GROUP BY review_status`,
      [jobId],
    );
    const out: Record<string, number> = {};
    for (const r of res.rows) out[r.review_status] = r.n;
    return out as Record<ReviewStatus, number>;
  }

export async function upsertApprovedQa(
  host: ReviewHost,
  client: PoolClient,
    rows: readonly { question: string; answer: string; jobId: string; itemId: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r, i) => {
      const o = i * 5;
      values.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, NOW())`);
      params.push(randomUUID(), r.question, r.answer, r.jobId, r.itemId);
    });
    await client.query(
      `INSERT INTO approved_qa (id, question, answer, source_job_id, source_item_id, created_at)
       VALUES ${values.join(', ')}
       ON CONFLICT (question) DO UPDATE
         SET answer = EXCLUDED.answer,
             source_job_id = EXCLUDED.source_job_id,
             source_item_id = EXCLUDED.source_item_id`,
      params,
    );
  }

  /** 同源短路：sourceHash 命中可复用状态的最近一个 job */
