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
import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join, extname } from 'path';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { SensitiveRedactor } from './sensitive-redactor.js';
import {
  parseImport,
  pickParser,
  UnsupportedFormatError,
  MissingColumnError,
} from './import-parser.js';
import type {
  ImportJob,
  ImportJobRow,
  ImportJobStatus,
  ImportItem,
  ReviewStatus,
  ImportJobListQuery,
  ImportItemListQuery,
} from './import-job.entity.js';
export type { ImportJobListQuery, ImportItemListQuery };

/** 命中即短路，不再重复解析的历史状态 */
const REUSABLE_STATUSES: readonly ImportJobStatus[] = [
  'parsed', 'approved', 'partial', 'rejected',
];

/**
 * 可删除状态 —— 都还没进知识库，删了不留脏数据。
 * approved/partial/rejected 已生效，删除会留下无主知识条目，故禁止。
 */
const DELETABLE_STATUSES: readonly ImportJobStatus[] = [
  'uploaded', 'parsing', 'parsed', 'failed',
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
  pending:    ['pending', 'approved', 'rejected', 'needs-fix'],
  approved:   ['approved', 'rejected', 'needs-fix'],
  rejected:   ['pending', 'approved', 'rejected', 'needs-fix'],
  'needs-fix': ['approved', 'rejected'],
};

/**
 * item 分布 → job 终态。
 * - 返回 null：仍存在 pending/needs-fix，job 保持 parsed（不写盘）。
 * - 返回 'parsed'：没 items（空 job，spec 视为已解析完的零结果）。
 * - 其他：全部 item 收敛到终态，按 approved/rejected 比例给 job 升 approved/partial/rejected。
 *
 * approved > 0 且 rejected === 0 → approved
 * approved > 0 且 rejected >  0 → partial
 * approved === 0 且 rejected >  0 → rejected
 */
function aggregateStatus(
  counts: Record<ReviewStatus, number>,
): ImportJobStatus | null {
  const pending = counts.pending;
  const nf = counts['needs-fix'];
  if (pending > 0 || nf > 0) return null;
  const approved = counts.approved;
  const rejected = counts.rejected;
  if (approved > 0 && rejected > 0) return 'partial';
  if (approved > 0) return 'approved';
  if (rejected > 0) return 'rejected';
  return 'parsed';
}

/** UPDATE 的受影响行数：优先驱动给的 rowCount/affectedRows，退化到 rows.length */
function affectedCount(res: { rowCount?: number | null; rows: Record<string, unknown>[] }): number {
  if (typeof res.rowCount === 'number') return res.rowCount;
  const first = res.rows[0] as { affectedRows?: number } | undefined;
  if (first && typeof first.affectedRows === 'number') return first.affectedRows;
  return res.rows.length;
}

function isDeletable(status: ImportJobStatus): boolean {
  return DELETABLE_STATUSES.includes(status);
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

function emptyStatusCounts(): Record<ImportJobStatus, number> {
  return {
    uploaded: 0, parsing: 0, parsed: 0, failed: 0,
    approved: 0, partial: 0, rejected: 0,
  };
}

export interface ImportJobPage {
  items: ImportJob[];
  /** 过滤后的总数 */
  total: number;
  limit: number;
  offset: number;
}

export interface ImportItemPage {
  items: ImportItem[];
  total: number;
  limit: number;
  offset: number;
}

/** 详情视图：job 概要 + 审核分布 + 能否删除（前端据此决定是否渲染删除按钮） */
export interface ImportJobDetail {
  job: ImportJob;
  itemCounts: Record<ReviewStatus, number>;
  deletable: boolean;
}

/** 建 job 后需带回调用方的运行时信息（不入库） */
export interface ImportJobCreated {
  job: ImportJob;
  /** true = 命中同源短路，未新建任务、未重复解析 */
  reused: boolean;
  /** 落盘路径，parseJob 用 */
  storedPath: string;
  /** 归一后的 MIME，parseJob 用 */
  mimeType: string;
}

export interface CreateFromFileInput {
  /** 原始文件名（扩展名用于 MIME 推断 + 展示） */
  filename: string;
  /** MIME（multipart 的 content-type，或由扩展名推断） */
  mimeType: string;
  /** 文件字节 */
  bytes: Buffer;
  /** 任务展示名；缺省用 filename */
  name?: string;
}

@Injectable()
export class ImportJobService {
  private readonly logger = new AppLogger('ImportJobService');
  private readonly pool: Pool;

  constructor(
    _config: ConfigService,
    private readonly redactor: SensitiveRedactor,
  ) {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  /**
   * multipart 上传建任务。
   * 顺序：大小校验(413) → MIME 早拒(415) → sha256 → 同源短路 → 落盘 → 建 job。
   * MIME 早拒让错误在建 job 前返回，不留 uploaded 孤儿行。
   */
  async createFromFile(input: CreateFromFileInput): Promise<ImportJobCreated> {
    // 路径穿越 / 非法文件名 → 400（spec: import storage path isolation）
    if (isUnsafeFilename(input.filename)) {
      throw new HttpException(
        { errCode: 'IMPORT_UNSAFE_FILENAME', detail: `unsafe filename: ${input.filename}` },
        HttpStatus.BAD_REQUEST,
      );
    }
    // 扩展名白名单（有扩展名时）→ 415（spec: upload extension validation）
    const ext = extname(input.filename).toLowerCase();
    if (ext && !ALLOWED_EXT.has(ext)) {
      throw new HttpException(
        {
          errCode: 'UNSUPPORTED_EXTENSION',
          detail: `unsupported extension: ${ext}`,
          allowed: [...ALLOWED_EXT],
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const maxBytes = ConfigService.instance.IMPORT_MAX_FILE_BYTES;
    if (input.bytes.length > maxBytes) {
      throw new HttpException(
        {
          errCode: 'IMPORT_FILE_TOO_LARGE',
          detail: `file is ${input.bytes.length} bytes, exceeds limit ${maxBytes}`,
          maxBytes,
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (input.bytes.length === 0) {
      throw new HttpException(
        { errCode: 'IMPORT_EMPTY_FILE', detail: 'import file is empty' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const mimeType = resolveMimeType(input.mimeType, input.filename);
    try {
      pickParser(mimeType); // 未知 MIME → 415
    } catch (err) {
      if (err instanceof UnsupportedFormatError) {
        throw new HttpException(
          {
            errCode: 'UNSUPPORTED_MEDIA_TYPE',
            detail: `unsupported MIME type: ${mimeType}`,
            allowed: err.allowed,
          },
          HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        );
      }
      throw err;
    }

    const sourceHash = createHash('sha256').update(input.bytes).digest('hex');
    const reused = await this.findReusableJob(sourceHash);
    if (reused !== null) {
      this.logger.log({
        detail: 'import-reused',
        jobId: reused.id,
        sourceHash: sourceHash.slice(0, 12),
      });
      return { job: reused, reused: true, storedPath: '', mimeType };
    }

    const id = randomUUID();
    const storedPath = await this.persistBytes(id, input.filename, input.bytes);
    this.logger.log({ detail: 'import-stored', jobId: id, bytes: input.bytes.length });

    const now = new Date().toISOString();
    const res = await this.pool.query(
      `INSERT INTO import_job
         (id, name, source_filename, source_hash, status, item_count, parse_error,
          stored_path, mime_type, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'uploaded',0,NULL,$6,$7,$5,$5)
       RETURNING *`,
      [id, input.name?.trim() || input.filename, input.filename, sourceHash, now, storedPath, mimeType],
    );
    return { job: mapJobRow(res.rows[0]), reused: false, storedPath, mimeType };
  }

  /**
   * 从 URL 抓取后建任务。抓取失败 / 超限 → 抛错，**不建 job**（避免无效任务污染列表）。
   */
  async createFromUrl(url: string, name?: string): Promise<ImportJobCreated> {
    const maxBytes = ConfigService.instance.IMPORT_MAX_FILE_BYTES_URL;

    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (err) {
      throw this.fetchError(url, `network error: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw this.fetchError(url, `HTTP ${res.status}`);
    }

    // Content-Length 存在时快速拒；缺失则以实际字节数兜底
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw this.tooLarge(declared, maxBytes);
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      throw this.fetchError(url, `body read failed: ${(err as Error).message}`);
    }
    if (bytes.length > maxBytes) throw this.tooLarge(bytes.length, maxBytes);
    if (bytes.length === 0) {
      throw new HttpException(
        { errCode: 'IMPORT_FETCH_FAILED', detail: `fetched content is empty: ${url}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    const filename = filenameFromUrl(url) || 'download';
    const contentType = res.headers.get('content-type') ?? '';
    return this.createFromFile({
      filename,
      mimeType: contentType === '' ? mimeFromExtension(filename) : contentType,
      bytes,
      name: name ?? filename,
    });
  }

  // -------------------------------------------------------------------------
  // 解析
  // -------------------------------------------------------------------------

  /**
   * uploaded → parsing → parsed/failed。
   * 解析结果逐条写 import_item（answer 经 SensitiveRedactor 脱敏）。
   * 任一步失败 → job.status=failed + parse_error，且不写任何 item（事务保证）。
   */
  /**
   * 触发解析。
   *
   * 落盘路径与 MIME **一律从 job 记录反查**，不接受调用方传入：
   * 客户端回传 storedPath 等于任意文件读取（可传 /etc/passwd 让解析器读盘），
   * 因此 parseJob 的入参只有 jobId。
   */
  async parseJob(jobId: string): Promise<ImportJob> {
    const job = await this.getJobRow(jobId);
    if (job === null) {
      throw new HttpException(
        { errCode: 'IMPORT_JOB_NOT_FOUND', detail: `import job ${jobId} not found` },
        HttpStatus.NOT_FOUND,
      );
    }
    if (job.status !== 'uploaded') {
      throw new HttpException(
        {
          errCode: 'IMPORT_BAD_STATE',
          detail: `import job is ${job.status}, expected uploaded`,
          status: job.status,
        },
        HttpStatus.CONFLICT,
      );
    }
    const storedPath = job.storedPath;
    if (storedPath === null || storedPath === '') {
      return this.failJob(jobId, 'stored file path missing');
    }
    const mimeType = job.mimeType ?? '';

    await this.updateStatus(jobId, 'parsing');

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(storedPath);
    } catch (err) {
      return this.failJob(jobId, `read failed: ${(err as Error).message}`);
    }

    let rows;
    try {
      rows = await parseImport(mimeType, bytes);
    } catch (err) {
      if (err instanceof UnsupportedFormatError || err instanceof MissingColumnError) {
        return this.failJob(jobId, err.message);
      }
      if (err instanceof SyntaxError) {
        return this.failJob(jobId, err.message);
      }
      return this.failJob(jobId, `parse failed: ${(err as Error).message}`);
    }

    try {
      await this.persistItems(jobId, rows);
    } catch (err) {
      return this.failJob(jobId, `persist failed: ${(err as Error).message}`);
    }

    await this.updateStatus(jobId, 'parsed', rows.length);
    this.logger.log({ detail: 'import-parsed', jobId, items: rows.length });
    return (await this.getJob(jobId))!;
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  async getJob(jobId: string): Promise<ImportJob | null> {
    const res = await this.pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
    return res.rows.length === 0 ? null : mapJob(res.rows[0]);
  }

  /**
   * 内部行视图：额外带出 stored_path / mime_type，供 parseJob 读盘用。
   * 这两个字段**只在本 service 内消费**，不经 DTO 出网（见 entity.ts 说明）。
   */
  private async getJobRow(jobId: string): Promise<ImportJobRow | null> {
    const res = await this.pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
    if (res.rows.length === 0) return null;
    const job = mapJob(res.rows[0]);
    return {
      ...job,
      storedPath: (res.rows[0].stored_path as string | null) ?? null,
      mimeType: (res.rows[0].mime_type as string | null) ?? null,
    };
  }

  /**
   * 列表分页。status 省略 = 不过滤。
   * total 是**过滤后**的总数（前端算页数用），不是全表数。
   */
  async listJobs(
    opts: ImportJobListQuery = {},
  ): Promise<ImportJobPage> {
    const limit = clamp(opts.limit ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = Math.max(0, opts.offset ?? 0);
    const status = opts.status === undefined ? null : opts.status;

    const where = status === null ? '' : 'WHERE status = $3';
    const params =
      status === null
        ? [limit, offset]
        : [limit, offset, status];

    const [page, count] = await Promise.all([
      this.pool.query(
        `SELECT * FROM import_job ${where}
          ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
        params,
      ),
      this.pool.query(
        status === null
          ? 'SELECT COUNT(*)::int AS n FROM import_job'
          : 'SELECT COUNT(*)::int AS n FROM import_job WHERE status = $1',
        status === null ? [] : [status],
      ),
    ]);

    return {
      items: page.rows.map(mapJob),
      total: Number(count.rows[0]?.n ?? 0),
      limit,
      offset,
    };
  }

  /** 各状态的 job 总数，供列表页筛选标签展示。不受 status 过滤影响。 */
  async countJobsByStatus(): Promise<Record<ImportJobStatus, number>> {
    const res = await this.pool.query(
      'SELECT status, COUNT(*)::int AS n FROM import_job GROUP BY status',
    );
    const out = emptyStatusCounts();
    for (const r of res.rows) out[r.status as ImportJobStatus] = Number(r.n);
    return out;
  }

  async listItems(
    jobId: string,
    opts: ImportItemListQuery = {},
  ): Promise<ImportItemPage> {
    const limit = clamp(opts.limit ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    const offset = Math.max(0, opts.offset ?? 0);

    const conds: string[] = ['job_id = $1'];
    const filterParams: unknown[] = [jobId];
    if (opts.reviewStatus) {
      filterParams.push(opts.reviewStatus);
      conds.push(`review_status = $${filterParams.length}`);
    }
    if (opts.sensitive === true) {
      conds.push('jsonb_array_length(sensitive_flags) > 0');
    } else if (opts.sensitive === false) {
      conds.push('jsonb_array_length(sensitive_flags) = 0');
    }
    const where = 'WHERE ' + conds.join(' AND ');

    const limitIdx = filterParams.length + 1;
    const offsetIdx = filterParams.length + 2;
    const pageParams = [...filterParams, limit, offset];

    const [page, count] = await Promise.all([
      this.pool.query(
        `SELECT * FROM import_item ${where}
          ORDER BY created_at ASC, id ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        pageParams,
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS n FROM import_item ${where}`,
        filterParams,
      ),
    ]);

    return {
      items: page.rows.map(mapItem),
      total: Number(count.rows[0]?.n ?? 0),
      limit,
      offset,
    };
  }

  /** 详情：job + item 审核状态分布。job 不存在返回 null。 */
  async getJobDetail(jobId: string): Promise<ImportJobDetail | null> {
    const job = await this.getJob(jobId);
    if (job === null) return null;
    return {
      job,
      itemCounts: await this.countItemsByStatus(jobId),
      deletable: isDeletable(job.status),
    };
  }

  async countItemsByStatus(
    jobId: string,
  ): Promise<Record<ReviewStatus, number>> {
    const res = await this.pool.query(
      `SELECT review_status, COUNT(*)::int AS n FROM import_item
        WHERE job_id = $1 GROUP BY review_status`,
      [jobId],
    );
    const out: Record<ReviewStatus, number> = {
      pending: 0, approved: 0, rejected: 0, 'needs-fix': 0,
    };
    for (const r of res.rows) out[r.review_status as ReviewStatus] = Number(r.n);
    return out;
  }

  // -------------------------------------------------------------------------
  // 删除
  // -------------------------------------------------------------------------

  /**
   * 删 job + 级联删 items + 清理落盘目录。
   *
   * 可删状态：uploaded / parsing / parsed（待审）/ failed —— 都还没进知识库。
   * approved / partial / rejected 已生效，删了会留下无主知识 → 409 拒绝。
   *
   * items 靠 import_item.job_id 的 ON DELETE CASCADE，不额外手写 DELETE；
   * 这里显式核对删除后的残留数，残留说明 schema 的 CASCADE 没生效，属故障。
   */
  async deleteJob(jobId: string): Promise<{ deletedItems: number }> {
    const job = await this.getJob(jobId);
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

    const before = await this.countItemsByStatus(jobId);
    const deletedItems = Object.values(before).reduce((a, b) => a + b, 0);

    await this.pool.query('DELETE FROM import_job WHERE id = $1', [jobId]);

    const after = await this.countItemsByStatus(jobId);
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

    // 磁盘目录 best-effort：删不掉不该让 API 报错，job 行已是权威状态
    try {
      await fs.rm(join(process.cwd(), 'data', 'import', jobId), { recursive: true, force: true });
    } catch (err) {
      this.logger.warn({
        detail: 'import-file-cleanup-failed', jobId, err: (err as Error).message,
      });
    }

    this.logger.log({ detail: 'import-deleted', jobId, items: deletedItems });
    return { deletedItems };
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
  async reviewItem(
    jobId: string,
    itemId: string,
    patch: { reviewStatus: ReviewStatus; note?: string },
  ): Promise<ImportItem> {
    const client = await this.pool.connect();
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
      if (!REVIEW_TRANSITIONS[from].includes(to)) {
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

      const updated = await client.query(
        `UPDATE import_item
            SET review_status = $3, reviewer_note = $4, reviewed_at = $5
          WHERE id = $1 AND job_id = $2
          RETURNING *`,
        [itemId, jobId, to, patch.note ?? null, new Date().toISOString()],
      );
      item = mapItem(updated.rows[0]);

      // 语料同步：from === to === 'approved'（同值幂等批）不重复写
      if (to === 'approved' && from !== 'approved') {
        await this.upsertApprovedQa(client, [
          { question: item.question, answer: item.answerRedacted, jobId, itemId },
        ]);
      } else if (from === 'approved' && to !== 'approved') {
        await client.query('DELETE FROM approved_qa WHERE source_item_id = $1', [itemId]);
      }

      await this.syncJobStatusInTx(client, jobId);
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
  async approveAll(
    jobId: string,
  ): Promise<{ approved: number; skippedSensitive: number; skippedNotPending: number }> {
    const jobRes = await this.pool.query('SELECT * FROM import_job WHERE id = $1', [jobId]);
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
    const preRes = await this.pool.query(
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
    const client = await this.pool.connect();
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

      await this.upsertApprovedQa(
        client,
        updated.rows.map((r: Record<string, unknown>) => ({
          question: r.question as string,
          answer: r.answer_redacted as string,
          jobId,
          itemId: r.id as string,
        })),
      );

      await this.syncJobStatusInTx(client, jobId, { skipIfUnchanged: true });
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    this.logger.log({
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
  private async syncJobStatus(
    jobId: string,
    opts: { skipIfUnchanged?: boolean } = {},
  ): Promise<void> {
    const status = aggregateStatus(await this.countItemsByStatus(jobId));
    if (status === null) {
      if (!opts.skipIfUnchanged) await this.updateStatus(jobId, 'parsed');
      return;
    }
    await this.updateStatus(jobId, status);
  }

  /**
   * 事务内版的 syncJobStatus：把聚合 SQL 跟 UPDATE 走同 client。
   * reviewItem / approveAll 在 BEGIN-COMMIT 之间调用，跨连接跑会读不到当前事务的 UPDATE。
   */
  private async syncJobStatusInTx(
    client: PoolClient,
    jobId: string,
    opts: { skipIfUnchanged?: boolean } = {},
  ): Promise<void> {
    const counts = await this.countItemsByStatusInTx(client, jobId);
    const status = aggregateStatus(counts);
    if (status === null) {
      if (!opts.skipIfUnchanged) await this.updateStatusInTx(client, jobId, 'parsed');
      return;
    }
    await this.updateStatusInTx(client, jobId, status);
  }

  private async countItemsByStatusInTx(
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

  private async updateStatusInTx(
    client: PoolClient,
    jobId: string,
    status: ImportJobStatus,
  ): Promise<void> {
    await client.query('UPDATE import_job SET status = $2 WHERE id = $1', [jobId, status]);
  }

  /**
   * 把审核通过的 (question, answerRedacted) 批量 upsert 到 approved_qa。
   * answer 用的是 answer_redacted：脱敏后才是知识库的检索/展示形态，原始敏感版不进库。
   * 冲突键：question UNIQUE —— 同问句复用同一行，重新批时答案被覆盖（也包括把待修 → 通过）；
   * source_item_id 不唯一是因为同一道题可能来自多个历史 job（去重后保留首条 source 即可）。
   * id 由应用层生成（与 import_job / import_item 一致，不依赖 pgcrypto 扩展）。
   */
  private async upsertApprovedQa(
    client: PoolClient,
    rows: readonly { question: string; answer: string; jobId: string; itemId: string }[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const values: string[] = [];
    const params: unknown[] = [];
    rows.forEach((r, i) => {
      const o = i * 6;
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
  private async findReusableJob(sourceHash: string): Promise<ImportJob | null> {
    const res = await this.pool.query(
      `SELECT * FROM import_job
        WHERE source_hash = $1 AND status = ANY($2::varchar[])
        ORDER BY created_at DESC LIMIT 1`,
      [sourceHash, REUSABLE_STATUSES],
    );
    return res.rows.length === 0 ? null : mapJob(res.rows[0]);
  }

  /** 写文件到 data/import/<jobId>/source<ext>。扩展名只保留短后缀，防路径穿越。 */
  private async persistBytes(jobId: string, filename: string, bytes: Buffer): Promise<string> {
    const dir = join(process.cwd(), 'data', 'import', jobId);
    await fs.mkdir(dir, { recursive: true });
    const ext = extname(filename).slice(0, 16);
    const target = join(dir, `source${ext}`);
    await fs.writeFile(target, bytes);
    return target;
  }

  /** 单事务写 item：要么全写要么全不写 */
  private async persistItems(
    jobId: string,
    rows: readonly { question: string; answer: string }[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const now = new Date().toISOString();
      for (const row of rows) {
        const red = this.redactor.redact(row.answer);
        await client.query(
          `INSERT INTO import_item
             (id, job_id, question, answer_raw, answer_redacted, sensitive_flags, review_status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending',$7)`,
          [
            randomUUID(), jobId, row.question, row.answer,
            red.text, JSON.stringify(red.flags), now,
          ],
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
    return (await this.getJob(jobId))!;
  }

  private fetchError(url: string, detail: string): HttpException {
    return new HttpException(
      { errCode: 'IMPORT_FETCH_FAILED', detail: `import fetch failed: ${detail}`, url },
      HttpStatus.BAD_GATEWAY,
    );
  }

  private tooLarge(size: number, maxBytes: number): HttpException {
    return new HttpException(
      { errCode: 'IMPORT_FILE_TOO_LARGE', detail: `fetched ${size} bytes, limit ${maxBytes}`, maxBytes },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

function mapJobRow(row: Record<string, unknown>): ImportJobRow {
  return {
    ...mapJob(row),
    storedPath: row.stored_path === null || row.stored_path === undefined ? null : String(row.stored_path),
    mimeType: row.mime_type === null || row.mime_type === undefined ? null : String(row.mime_type),
  };
}

function mapJob(row: Record<string, unknown>): ImportJob {
  return {
    id: String(row.id),
    name: String(row.name),
    sourceFilename: String(row.source_filename),
    sourceHash: String(row.source_hash),
    status: row.status as ImportJobStatus,
    itemCount: Number(row.item_count ?? 0),
    parseError: row.parse_error === null || row.parse_error === undefined ? null : String(row.parse_error),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/** 行视图 → DTO：剥掉 storedPath / mimeType，落盘路径永不出内网 API。 */
function toJobDto(row: ImportJobRow): ImportJob {
  const { storedPath: _s, mimeType: _m, ...dto } = row;
  return dto;
}

function mapItem(row: Record<string, unknown> | undefined): ImportItem {
  if (!row) {
    return {
      id: '', jobId: '', question: '', answerRaw: '', answerRedacted: '',
      sensitiveFlags: [], reviewStatus: 'pending', reviewedAt: null,
      reviewerNote: null, createdAt: '',
    };
  }
  const flags = row.sensitive_flags;
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    question: String(row.question),
    answerRaw: String(row.answer_raw),
    answerRedacted: String(row.answer_redacted),
    sensitiveFlags: Array.isArray(flags) ? flags.map(String) : [],
    reviewStatus: row.review_status as ImportItem['reviewStatus'],
    reviewedAt: row.reviewed_at == null ? null : new Date(row.reviewed_at as string).toISOString(),
    reviewerNote: row.reviewer_note == null ? null : String(row.reviewer_note),
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

const EXT_MIME: Readonly<Record<string, string>> = {
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/plain',
  '.json': 'application/jsonl',
  '.jsonl': 'application/jsonl',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function mimeFromExtension(filename: string): string {
  return EXT_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * multipart 的 content-type 常是 application/octet-stream 或空，此时回退扩展名推断；
 * 真实 MIME（text/csv 等）优先采信。去掉 charset 后缀。
 */
function resolveMimeType(mimeType: string, filename: string): string {
  const m = (mimeType ?? '').toLowerCase().trim();
  if (m === '' || m === 'application/octet-stream' || m === 'binary/octet-stream') {
    return mimeFromExtension(filename);
  }
  return m.split(';')[0].trim();
}

function filenameFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop();
    return seg === undefined ? '' : decodeURIComponent(seg);
  } catch {
    return '';
  }
}
