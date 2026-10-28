/**
 * 导入确认入库、回滚、重试与终态重算
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppLogger } from '../common/logger.js';
import type { DatasetClient } from './fastgpt-dataset.client.js';
import type { ImportJob, ImportJobStatus, ReviewStatus } from './import-job.entity.js';

export interface ConfirmHost {
  pool: Pool;
  logger: AppLogger;
  getJob(jobId: string): Promise<ImportJob | null>;
  getDatasetClient(): DatasetClient;
  refreshImportCounters(jobId: string): Promise<void>;
  cleanupSource(jobId: string): Promise<void>;
  updateStatus(jobId: string, status: ImportJobStatus, itemCount?: number): Promise<void>;
}

export async function runConfirm(
  host: ConfirmHost,
  jobId: string,
    decisions: readonly { itemId: string; reviewStatus: ReviewStatus }[],
  ): Promise<{ approved: number; written: number; dataset: string }> {
    const job = await host.getJob(jobId);
    if (job === null) {
      throw new HttpException(
        { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }

    for (const d of decisions) {
      if (d.reviewStatus === 'modified') {
        throw new HttpException(
          {
            errCode: 'IMPORT_MODIFIED_VIA_PATCH',
            detail: 'use PATCH /items/:id to submit a modified decision with revised answer',
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      await host.pool.query(
        `UPDATE import_item
            SET review_status = $3, reviewed_at = $4, updated_at = $4
          WHERE job_id = $1 AND id = $2`,
        [jobId, d.itemId, d.reviewStatus, new Date().toISOString()],
      );
    }

    // 丢弃条目不留正文（保留 source_hash 作为幂等键）
    await host.pool.query(
      `UPDATE import_item
          SET question = NULL, answer_raw = NULL, answer_redacted = NULL, updated_at = $2
        WHERE job_id = $1 AND review_status = 'rejected'`,
      [jobId, new Date().toISOString()],
    );

    const toImport = await host.pool.query(
      `SELECT id, question, answer_redacted FROM import_item
        WHERE job_id = $1 AND review_status IN ('approved', 'modified')
          AND auto_blocked = false AND imported_qa_id IS NULL
        ORDER BY created_at ASC`,
      [jobId],
    );

    const datasetName = `历史语料-${jobId}`;
    let written = 0;
    try {
      if (toImport.rows.length > 0) {
        const client = host.getDatasetClient();
        const datasetId = await client.ensureDataset(datasetName);
        await host.pool.query('UPDATE import_job SET dataset_id = $2 WHERE id = $1', [jobId, datasetId]);
        const batchSize = 50;
        for (let i = 0; i < toImport.rows.length; i += batchSize) {
          const batch = toImport.rows.slice(i, i + batchSize);
          const ids = await client.writeBatch(
            datasetId,
            batch.map((r) => ({ question: String(r.question), answer: String(r.answer_redacted ?? '') })),
          );
          for (let j = 0; j < batch.length; j++) {
            await host.pool.query('UPDATE import_item SET imported_qa_id = $2 WHERE id = $1', [
              batch[j].id,
              ids[j] ?? null,
            ]);
          }
          written += batch.length;
        }
        await host.pool.query('UPDATE import_job SET dataset_name = $2 WHERE id = $1', [jobId, datasetName]);
      }
    } finally {
      // 失败也要落计数：approved 已定、imported 为已完成批次
      await host.refreshImportCounters(jobId);
    }

    // 重算 job 终态
    await recomputeJobStatus(host, jobId);
    await host.cleanupSource(jobId);

    return { approved: toImport.rows.length, written, dataset: datasetName };
  }

  /** 批次下线：删除数据集 collection，清空 imported_qa_id */
export async function rollback(host: ConfirmHost, jobId: string): Promise<{ rolledBack: boolean }> {
    const job = await host.getJob(jobId);
    if (job === null) {
      throw new HttpException(
        { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (job.status === 'rolled_back') return { rolledBack: true };
    const datasetName = job.datasetName ?? `历史语料-${jobId}`;
    const client = host.getDatasetClient();
    if (job.datasetId && client.deleteDatasetById) {
      await client.deleteDatasetById(job.datasetId);
    } else {
      await client.deleteDataset(datasetName);
    }
    await host.pool.query(
      `UPDATE import_item SET imported_qa_id = NULL WHERE job_id = $1 AND imported_qa_id IS NOT NULL`,
      [jobId],
    );
    await host.pool.query(
      `UPDATE import_job
          SET dataset_name = NULL, dataset_id = NULL, imported_count = 0,
              failed_count = GREATEST(approved_count, 0), updated_at = $2
        WHERE id = $1`,
      [jobId, new Date().toISOString()],
    );
    await host.updateStatus(jobId, 'rolled_back');
    return { rolledBack: true };
  }

  /** 仅重试失败写入（已 approved、未 imported、非 auto_blocked） */
export async function retry(host: ConfirmHost, jobId: string): Promise<{ retried: number }> {
    const res = await host.pool.query(
      `SELECT id, question, answer_redacted FROM import_item
        WHERE job_id = $1 AND review_status IN ('approved', 'modified')
          AND auto_blocked = false AND imported_qa_id IS NULL
        ORDER BY created_at ASC`,
      [jobId],
    );
    if (res.rows.length === 0) return { retried: 0 };

    const datasetName = `历史语料-${jobId}`;
    const client = host.getDatasetClient();
    const datasetId = await client.ensureDataset(datasetName);
    const ids = await client.writeBatch(
      datasetId,
      res.rows.map((r) => ({ question: String(r.question), answer: String(r.answer_redacted ?? '') })),
    );
    for (let i = 0; i < res.rows.length; i++) {
      await host.pool.query('UPDATE import_item SET imported_qa_id = $2 WHERE id = $1', [
        res.rows[i].id,
        ids[i] ?? null,
      ]);
    }
    await host.pool.query('UPDATE import_job SET dataset_name = $2 WHERE id = $1', [jobId, datasetName]);
    await host.refreshImportCounters(jobId);
    return { retried: res.rows.length };
  }

async function recomputeJobStatus(host: ConfirmHost, jobId: string): Promise<void> {
    const current = await host.getJob(jobId);
    if (current?.status === 'rolled_back') return;
    const res = await host.pool.query(
      `SELECT review_status, COUNT(*)::int AS n FROM import_item WHERE job_id = $1 GROUP BY review_status`,
      [jobId],
    );
    let approved = 0;
    let rejected = 0;
    let other = 0;
    let total = 0;
    for (const r of res.rows) {
      const n = Number(r.n);
      total += n;
      if (r.review_status === 'approved' || r.review_status === 'modified') approved += n;
      else if (r.review_status === 'rejected') rejected += n;
      else other += n;
    }
    let status: ImportJobStatus = 'parsed';
    if (total > 0) {
      if (approved === total) status = 'approved';
      else if (approved > 0) status = 'partial';
      else if (rejected === total) status = 'rejected';
      else if (approved === 0 && rejected > 0) status = 'rejected';
    }
    await host.updateStatus(jobId, status);
    void other;
  }

  /** 清理上传源文件（任务结束） */
