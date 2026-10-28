/**
 * 导入任务创建：文件上传 / URL 抓取 / 同源短路 / 落盘
 */
import { promises as fs } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { extname, join } from 'path';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import type { AppLogger } from '../common/logger.js';
import type { Pool } from 'pg';
import { filenameFromUrl, mapJob, mapJobRow, resolveMimeType } from './import-mappers.js';
import { pickParser, UnsupportedFormatError } from './import-parser.js';
import type {
  CreateFromFileInput,
  ImportJob,
  ImportJobCreated,
  ImportJobStatus,
} from './import-job.entity.js';

export interface CreateHost {
  pool: Pool;
  logger: AppLogger;
}

const REUSABLE_STATUSES: readonly ImportJobStatus[] = [
  'parsed', 'approved', 'partial', 'rejected',
];

const ALLOWED_EXT = new Set(['.txt', '.md', '.csv', '.json', '.jsonl', '.xlsx']);

function isUnsafeFilename(name: string): boolean {
  return /[\\/]/.test(name) || name.includes('..');
}

export async function createFromFile(
  host: CreateHost,
  input: CreateFromFileInput,
): Promise<ImportJobCreated> {
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
    const reused = await findReusableJob(host, sourceHash);
    if (reused !== null) {
      host.logger.log({
        detail: 'import-reused',
        jobId: reused.id,
        sourceHash: sourceHash.slice(0, 12),
      });
      return { job: reused, reused: true, storedPath: '', mimeType };
    }

    const id = randomUUID();
    const storedPath = await persistBytes(host, id, input.filename, input.bytes);
    host.logger.log({ detail: 'import-stored', jobId: id, bytes: input.bytes.length });

    const now = new Date().toISOString();
    const res = await host.pool.query(
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
export async function createFromUrl(
  host: CreateHost,
  url: string,
  name?: string,
): Promise<ImportJobCreated> {
    const maxBytes = ConfigService.instance.IMPORT_MAX_FILE_BYTES_URL;

    let res: Response;
    try {
      res = await fetch(url, { redirect: 'follow' });
    } catch (err) {
      throw fetchError(url, `network error: ${(err as Error).message}`);
    }
    if (!res.ok) {
      throw fetchError(url, `HTTP ${res.status}`);
    }

    // Content-Length 存在时快速拒；缺失则以实际字节数兜底
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw tooLarge(declared, maxBytes);
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      throw fetchError(url, `body read failed: ${(err as Error).message}`);
    }
    if (bytes.length > maxBytes) throw tooLarge(bytes.length, maxBytes);
    if (bytes.length === 0) {
      throw new HttpException(
        { errCode: 'IMPORT_FETCH_FAILED', detail: `fetched content is empty: ${url}` },
        HttpStatus.BAD_REQUEST,
      );
    }

    const filename = filenameFromUrl(url) || 'download';
    const contentType = res.headers.get('content-type') ?? '';
    return createFromFile(host, {
      filename,
      mimeType: contentType === '' ? resolveMimeType('', filename) : contentType,
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

async function findReusableJob(host: CreateHost, sourceHash: string): Promise<ImportJob | null> {
    const res = await host.pool.query(
      `SELECT * FROM import_job
        WHERE source_hash = $1 AND status = ANY($2::varchar[])
        ORDER BY created_at DESC LIMIT 1`,
      [sourceHash, REUSABLE_STATUSES],
    );
    return res.rows.length === 0 ? null : mapJob(res.rows[0]);
  }

  /** 写文件到 data/import/<jobId>/source<ext>。扩展名只保留短后缀，防路径穿越。 */
async function persistBytes(host: CreateHost, jobId: string, filename: string, bytes: Buffer): Promise<string> {
    const dir = join(process.cwd(), 'data', 'import', jobId);
    await fs.mkdir(dir, { recursive: true });
    const ext = extname(filename).slice(0, 16);
    const target = join(dir, `source${ext}`);
    await fs.writeFile(target, bytes);
    return target;
  }

function fetchError(url: string, detail: string): HttpException {
  return new HttpException(
    { errCode: 'IMPORT_FETCH_FAILED', detail: `import fetch failed: ${detail}`, url },
    HttpStatus.BAD_GATEWAY,
  );
}

function tooLarge(size: number, maxBytes: number): HttpException {
  return new HttpException(
    { errCode: 'IMPORT_FILE_TOO_LARGE', detail: `fetched ${size} bytes, limit ${maxBytes}`, maxBytes },
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
}
