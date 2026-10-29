/**
 * ImportJobService — M10 导入任务编排
 *
 * spec M10 §1.1 / §1.2：
 *   - createFromFile: multipart 上传 → 大小/MIME 校验 → sha256 → 同源短路 → 落盘 → 建 job(uploaded)
 *   - createFromUrl:  抓取远程字节 → 走 createFromFile 同一路径
 *   - parseJob:       uploaded → parsing → parsed（写 import_item）→ 失败落 failed
 *
 * 短路规则（spec §1.1 Scenario「同源文件已导入」）：sourceHash 命中 parsed/approved/
 * partial/rejected 中任一状态的历史 job → 直接返回该 job，不落盘不解析。
 *
 * 敏感信息：answer_raw 保留原文仅供授权审核；answer_redacted 是检索/展示用的脱敏版本。
 * 原文件落盘路径与 MIME 不入库（schema 无对应列），由调用方在建 job 时留存并传给 parseJob。
 */
import { Injectable, HttpException, HttpStatus, type OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { SensitiveRedactor } from './sensitive-redactor.js';
import { ImportCleaner, type CleanMessage } from './import-cleaner.js';
import { ImportBlacklist } from './import-blacklist.js';
import {
  HttpFastGptDatasetClient,
  InMemoryDatasetClient,
  type DatasetClient,
} from './fastgpt-dataset.client.js';
import {
  HttpFastGptSearchClient,
  NoopSearchClient,
  type FastGptSearchClient,
} from './near-duplicate.js';
import { buildJobManifest } from './import-manifest.js';
import { ImportLock } from './import-lock.js';
import { ImportTaskQueue } from './import-task-queue.js';
import { shouldPauseImport } from './import-memory.js';
import { CapacityGuard } from '../usage/capacity-guard.service.js';
import { listUnpaired, pairUnpaired } from './import-unpaired.js';
import { runParseJob, type ParseHost } from './import-parse.js';
import { createFromFile, createFromUrl, type CreateHost } from './import-create.js';
import { approveAll, reviewItem, type ReviewHost } from './import-review.js';
import { retry, rollback, runConfirm, type ConfirmHost } from './import-confirm.js';
import {
  countItemsByStatus,
  countJobsByStatus,
  deleteJob,
  getJob,
  getJobDetail,
  listItems,
  listJobs,
} from './import-query.js';
import {
  countStoredItems,
  persistItems,
  persistUnpaired,
  refreshImportCounters,
  updateMessageCounters,
  updateStageCounts,
} from './import-dedupe.js';
import type {
  ImportJob,
  ImportJobStatus,
  ImportItem,
  ReviewStatus,
  ImportJobListQuery,
  ImportItemListQuery,
  ImportJobPage,
  ImportItemPage,
  ImportJobDetail,
  ImportJobCreated,
  CreateFromFileInput,
} from './import-job.entity.js';
export type {
  ImportItemListQuery,
  ImportJobListQuery,
  ImportJobPage,
  ImportItemPage,
  ImportJobDetail,
  ImportJobCreated,
  CreateFromFileInput,
} from './import-job.entity.js';

/** RSS 是否超过限额的 80%（纯函数，便于单测） */
export function isMemoryHigh(rssBytes: number, limitMb: number): boolean {
  return rssBytes > limitMb * 1024 * 1024 * 0.8;
}

/** 命中即短路，不再重复解析的历史状态 */
const REUSABLE_STATUSES: readonly ImportJobStatus[] = [
  'parsed', 'approved', 'partial', 'rejected',
];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/** 允许的导入文件扩展名（spec: .txt/.md/.csv/.json/.xlsx，兼容 .jsonl） */
const ALLOWED_EXT = new Set(['.txt', '.md', '.csv', '.json', '.jsonl', '.xlsx']);

/** 文件名含路径分隔符或 .. → 视为路径穿越（spec: import storage path isolation） */
function isUnsafeFilename(name: string): boolean {
  return /[\\/]/.test(name) || name.includes('..');
}

/**
 * 逐条 PATCH 审核的状态机（见 reviewItem 注释）。
 * 终态值（approved/rejected）之间的互相来回由 from==='pending' 那一组覆盖，
 * 任何状态都允许回到 pending（除了 needs-fix，见方法注释）。
 */
const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  pending:    ['pending', 'approved', 'modified', 'rejected', 'needs-fix'],
  approved:   ['approved', 'modified', 'rejected', 'needs-fix'],
  modified:   ['approved', 'modified', 'rejected', 'needs-fix'],
  rejected:   ['pending', 'approved', 'modified', 'rejected', 'needs-fix'],
  'needs-fix': ['approved', 'modified', 'rejected'],
};

@Injectable()
export class ImportJobService implements OnModuleInit {
  private readonly logger = new AppLogger('ImportJobService');
  private readonly pool: Pool;
  private readonly lock: ImportLock;
  private readonly tasks = new ImportTaskQueue();
  private importBaselineRss = 0;

  constructor(
    _config: ConfigService,
    private readonly redactor: SensitiveRedactor,
    private readonly capacityGuard?: CapacityGuard,
  ) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
    this.lock = new ImportLock(this.pool);
  }

  async onModuleInit(): Promise<void> {
    await this.pool
      .query("UPDATE import_job SET status='failed', parse_error='interrupted by restart', updated_at=NOW() WHERE status='parsing'")
      .catch(() => undefined);
    await this.lock.resetOnBoot();
  }

  // --- 重管线依赖（惰性构建；测试可注入 dataset/search） ---
  private _cleaner?: ImportCleaner;
  private _blacklist?: ImportBlacklist;
  private _dataset?: DatasetClient;
  private _search?: FastGptSearchClient;

  setDatasetClient(c: DatasetClient): void {
    this._dataset = c;
  }

  setSearchClient(c: FastGptSearchClient): void {
    this._search = c;
  }

  private getCleaner(): ImportCleaner {
    if (!this._cleaner) {
      const p = ConfigService.instance.IMPORT_RULES_FILE;
      this._cleaner = p ? ImportCleaner.fromFile(p) : new ImportCleaner();
    }
    return this._cleaner;
  }

  private getBlacklist(): ImportBlacklist {
    if (!this._blacklist) {
      const p = ConfigService.instance.IMPORT_BLACKLIST_FILE;
      this._blacklist = p ? ImportBlacklist.fromFile(p) : new ImportBlacklist();
    }
    return this._blacklist;
  }

  private getDatasetClient(): DatasetClient {
    if (!this._dataset) {
      const cfg = ConfigService.instance;
      this._dataset =
        cfg.FASTGPT_BASE_URL && cfg.FASTGPT_API_KEY
          ? new HttpFastGptDatasetClient({
              baseUrl: cfg.FASTGPT_BASE_URL,
              apiKey: cfg.FASTGPT_API_KEY,
            })
          : new InMemoryDatasetClient();
    }
    return this._dataset;
  }

  private getSearchClient(): FastGptSearchClient {
    if (!this._search) {
      const cfg = ConfigService.instance;
      this._search =
        cfg.FASTGPT_BASE_URL && cfg.FASTGPT_API_KEY && cfg.FASTGPT_DATASET_IDS
          ? new HttpFastGptSearchClient({
              baseUrl: cfg.FASTGPT_BASE_URL,
              apiKey: cfg.FASTGPT_API_KEY,
              datasetIds: cfg.FASTGPT_DATASET_IDS.split(',').map((s) => s.trim()).filter(Boolean),
            })
          : new NoopSearchClient();
    }
    return this._search;
  }

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  /**
   * multipart 上传建任务。
   * 顺序：大小校验(413) → MIME 早拒(415) → sha256 → 同源短路 → 落盘 → 建 job。
   * MIME 早拒让错误在建 job 前返回，不留 uploaded 孤儿行。
   */
  createFromFile(input: CreateFromFileInput): Promise<ImportJobCreated> {
    return createFromFile(this as unknown as CreateHost, input);
  }

  createFromUrl(url: string, name?: string): Promise<ImportJobCreated> {
    return createFromUrl(this as unknown as CreateHost, url, name);
  }

  async parseJob(jobId: string): Promise<ImportJob> {
    await this.acquireImportLock(jobId, 'parsing');
    try {
      return await runParseJob(this as unknown as ParseHost, jobId);
    } finally {
      await this.releaseImportLock(jobId);
    }
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  /**
   * 异步启动解析：校验状态 + 抢租约 + 入队，立即返回当前 job；HTTP 层返回 202。
   */
  async startParse(jobId: string): Promise<ImportJob> {
    const job = await getJob(this.pool, jobId);
    if (job === null) {
      throw new HttpException(
        { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (job.status !== 'uploaded') {
      throw new HttpException(
        { errCode: 'IMPORT_BAD_STATE', detail: `import job is ${job.status}, expected uploaded`, status: job.status },
        HttpStatus.CONFLICT,
      );
    }
    await this.lock.acquire(jobId, 'parsing');
    const accepted = this.tasks.enqueue(async () => {
      try {
        await runParseJob(this as unknown as ParseHost, jobId);
      } finally {
        this.importBaselineRss = 0;
        await this.lock.release(jobId);
      }
    });
    if (!accepted) {
      await this.lock.release(jobId);
      throw new HttpException(
        { errCode: 'IMPORT_BUSY', detail: 'import task queue is full' },
        HttpStatus.CONFLICT,
      );
    }
    return job;
  }

  async getJob(jobId: string): Promise<ImportJob | null> {
    return getJob(this.pool, jobId);
  }

  async listJobs(opts: ImportJobListQuery = {}): Promise<ImportJobPage> {
    return listJobs(this.pool, opts);
  }

  async countJobsByStatus(): Promise<Record<ImportJobStatus, number>> {
    return countJobsByStatus(this.pool);
  }

  async listItems(jobId: string, opts: ImportItemListQuery = {}): Promise<ImportItemPage> {
    return listItems(this.pool, jobId, opts);
  }

  async getJobDetail(jobId: string): Promise<ImportJobDetail | null> {
    return getJobDetail(this.pool, jobId);
  }

  async countItemsByStatus(jobId: string): Promise<Record<ReviewStatus, number>> {
    return countItemsByStatus(this.pool, jobId);
  }

  listUnpaired(jobId: string, limit = 50, offset = 0) {
    return listUnpaired(this.pool, jobId, limit, offset);
  }

  pairUnpaired(jobId: string, customerMessageId: string, serviceMessageId: string) {
    return pairUnpaired(
      { pool: this.pool, redactor: this.redactor, blacklist: this.getBlacklist() },
      jobId,
      customerMessageId,
      serviceMessageId,
    );
  }

  async deleteJob(jobId: string): Promise<{ deletedItems: number }> {
    return deleteJob(this.pool, jobId);
  }

  // -------------------------------------------------------------------------
  // 审核流转
  // -------------------------------------------------------------------------

  /**
   * 逐条 PATCH 审核结论。
   *
   * 状态机（spec M10 §3.1）：
   *   pending   → pending/approved/rejected/needs-fix
   *   approved  → approved/rejected/needs-fix（可反悔，也可回退待修）
   *   rejected  → 同 pending（可重新启用）
   *   needs-fix → 仅 approved/rejected —— 一旦离开待修态就不能再退回待修，
   *               否则审核员可以无限循环「打回 → 再打回」而不做决定
   *
   * 敏感项在这里**允许**逐条通过：脱敏标记只是提醒，授权审核员可以人工放行。
   * approveAll 才必须跳过敏感项（无人值守批量，不能替人做这个决定）。
   *
   * 每次都回写 job.status（即使仍是 parsed）—— 逐条动作低频，顺带同步成本可忽略，
   * 也让列表页的聚合列不必等下一次批量操作才刷新。
   *
   * 语料同步（3.2）：item 状态与 approved_qa 写在同一事务 —— 进 approved 时 upsert
   * 语料（answer_redacted 进库，脱敏版才是检索/展示形态），离开 approved 时删除对应行。
   * 这样 reject 一个曾 approve 的条目能干净撤回知识库。
   */
  reviewItem(
    jobId: string,
    itemId: string,
    patch: { reviewStatus: ReviewStatus; note?: string; question?: string; answer?: string },
  ): Promise<ImportItem> {
    return reviewItem(this as unknown as ReviewHost, jobId, itemId, patch);
  }

  approveAll(jobId: string): Promise<{ approved: number; skippedSensitive: number; skippedNotPending: number }> {
    return approveAll(this as unknown as ReviewHost, jobId);
  }

  /** 导入内存保护：RSS 超过限额 80% 时暂停，恢复后继续（保留进度） */
  private async guardMemory(): Promise<void> {
    const configured = ConfigService.instance.IMPORT_MEMORY_LIMIT_MB ?? 512;
    if (this.importBaselineRss === 0) this.importBaselineRss = process.memoryUsage().rss;
    for (;;) {
      const rss = process.memoryUsage().rss;
      const incrementalMb = (rss - this.importBaselineRss) / 1024 / 1024;
      if (!shouldPauseImport(rss, this.importBaselineRss, configured)) return;
      this.logger.warn({
        detail: 'import-memory-pause',
        rssMb: Math.round(rss / 1024 / 1024),
        incrementalMb: Math.round(incrementalMb),
        limitMb: configured,
      });
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  /** 单事务写 item：要么全写要么全不写 */
  private async persistItems(
    jobId: string,
    rows: readonly {
      question: string;
      answer: string;
      conversationId?: string;
      occurredAt?: number;
    }[],
  ): Promise<{ inserted: number; dedup: number }> {
    return persistItems(
      {
        pool: this.pool,
        redactor: this.redactor,
        blacklist: this.getBlacklist(),
        search: this.getSearchClient(),
        guardMemory: () => this.guardMemory(),
      },
      jobId,
      rows,
    );
  }

  private persistUnpaired(jobId: string, messages: readonly CleanMessage[]): Promise<void> {
    return persistUnpaired(this.pool, jobId, messages);
  }

  private updateStageCounts(
    jobId: string,
    totalMessages: number,
    cleaned: number,
    paired: number,
    unpaired: number,
  ): Promise<void> {
    return updateStageCounts(this.pool, jobId, totalMessages, cleaned, paired, unpaired);
  }

  private updateMessageCounters(
    jobId: string,
    totalMessages: number,
    parsedMessages: number,
  ): Promise<void> {
    return updateMessageCounters(this.pool, jobId, totalMessages, parsedMessages);
  }

  private refreshImportCounters(jobId: string): Promise<void> {
    return refreshImportCounters(this.pool, jobId);
  }

  private countStoredItems(jobId: string): Promise<number> {
    return countStoredItems(this.pool, jobId);
  }

  // -------------------------------------------------------------------------
  // 单任务租约（实现见 import-lock.ts）
  // -------------------------------------------------------------------------

  private acquireImportLock(jobId: string, stage: string): Promise<void> {
    return this.lock.acquire(jobId, stage);
  }

  private releaseImportLock(jobId: string): Promise<void> {
    return this.lock.release(jobId);
  }

  /** 崩溃后运维强制释放租约 */
  forceReleaseImportLock(): Promise<{ released: boolean }> {
    return this.lock.forceRelease();
  }

  // -------------------------------------------------------------------------
  // 审核清单 / 提交 / 回滚 / 重试（重管线）
  // -------------------------------------------------------------------------

  /** 生成 review.xlsx（脱敏后，30 天保留期） */
  async buildManifest(jobId: string): Promise<Buffer> {
    return buildJobManifest(this.pool, jobId);
  }

  /**
   * 提交审核结果并写入 FastGPT 数据集。
   * decisions: [{ itemId, reviewStatus }]；approved 且非 auto_blocked 的 item 写入 `历史语料-<jobId>`。
   */
  async confirm(
    jobId: string,
    decisions: readonly { itemId: string; reviewStatus: ReviewStatus }[],
  ): Promise<{ approved: number; written: number; dataset: string }> {
    await this.acquireImportLock(jobId, 'importing');
    try {
      return await runConfirm(this as unknown as ConfirmHost, jobId, decisions);
    } finally {
      await this.releaseImportLock(jobId);
    }
  }

  rollback(jobId: string): Promise<{ rolledBack: boolean }> {
    return rollback(this as unknown as ConfirmHost, jobId);
  }

  retry(jobId: string): Promise<{ retried: number }> {
    return retry(this as unknown as ConfirmHost, jobId);
  }

  private async cleanupSource(jobId: string): Promise<void> {
    try {
      await fs.rm(join(process.cwd(), 'data', 'import', jobId), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  private async updateStatusUnlessRolledBack(jobId: string, status: ImportJobStatus): Promise<void> {
    await this.pool.query(
      `UPDATE import_job SET status = $2, updated_at = $3 WHERE id = $1 AND status <> 'rolled_back'`,
      [jobId, status, new Date().toISOString()],
    );
  }

  private async updateStatusInTxUnlessRolledBack(
    client: PoolClient,
    jobId: string,
    status: ImportJobStatus,
  ): Promise<void> {
    await client.query(
      `UPDATE import_job SET status = $2, updated_at = $3 WHERE id = $1 AND status <> 'rolled_back'`,
      [jobId, status, new Date().toISOString()],
    );
  }

  private async updateStatus(
    jobId: string,
    status: ImportJobStatus,
    itemCount?: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE import_job
          SET status = $2, updated_at = $3 ${itemCount === undefined ? '' : ', item_count = $4'}
        WHERE id = $1`,
      itemCount === undefined
        ? [jobId, status, new Date().toISOString()]
        : [jobId, status, new Date().toISOString(), itemCount],
    );
  }

  private async failJob(jobId: string, message: string): Promise<ImportJob> {
    this.logger.warn({ detail: 'import-failed', jobId, err: message });
    await this.pool.query(
      `UPDATE import_job SET status = 'failed', parse_error = $2, updated_at = $3
        WHERE id = $1`,
      [jobId, message.slice(0, 1000), new Date().toISOString()],
    );
    await this.refreshImportCounters(jobId).catch(() => undefined);
    await this.cleanupSource(jobId).catch(() => undefined);
    return (await this.getJob(jobId))!;
  }


}
