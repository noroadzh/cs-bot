/**
 * MissExportService
 * - queryRecords: JSON 导出走全量查询
 * - exportXlsx: 通过 ExcelJS.stream.xlsx.WorkbookWriter 直写 HTTP response，
 *   配合 pg 游标（cursor）逐批 fetch，避免把整个结果集缓存在内存中
 */
import { Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import ExcelJS from 'exceljs';
import type { Writable } from 'stream';
import { ConfigService } from '../config/config.service.js';
import { maskPII } from '@cs-bot/shared';

export interface MissRange {
  from?: string;
  to?: string;
}

function buildWhere(days: number, range?: MissRange): { sql: string; params: unknown[] } {
  if (range?.from || range?.to) {
    const parts: string[] = [];
    const params: unknown[] = [];
    if (range.from) { params.push(range.from); parts.push(`created_at >= $${params.length}::timestamptz`); }
    if (range.to) { params.push(range.to); parts.push(`created_at <= $${params.length}::timestamptz`); }
    return { sql: parts.join(' AND '), params };
  }
  const daysNum = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 90;
  return { sql: `created_at >= now() - interval '${daysNum} days'`, params: [] };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** JSON 导出条目：仅规格列出的字段，userId 掩码；不含 trace_id/engine */
export interface MissExportItem {
  question: string;
  chatId: string;
  score: number;
  mediaType: string | null;
  status: number;
  createdAt: string;
  userId: string;
}

export function toExportItems(rows: readonly Record<string, unknown>[]): MissExportItem[] {
  return rows.map((r) => ({
    question: String(r.question ?? ''),
    chatId: String(r.chat_id ?? ''),
    score: Number(r.score ?? 0),
    mediaType: (r.mediaType as string | null) ?? null,
    status: Number(r.status ?? 0),
    createdAt: new Date(r.created_at as string).toISOString(),
    userId: maskPII(String(r.user_id ?? ''), 'userid'),
  }));
}

const HEADER = ['traceId', 'chatId', 'userId', 'question', 'score', 'engine', 'mediaType', 'status', 'createdAt'] as const;
const EXPORT_LIMIT = 50000;
const FETCH_BATCH = 2000;

@Injectable()
export class MissExportService {
  constructor(_config: ConfigService) {}

  async queryRecords(days = 90, range?: MissRange): Promise<any[]> {
    const pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL });
    try {
      const where = buildWhere(days, range);
      const result = await pool.query(
        `SELECT trace_id, chat_id, user_id, question, score, engine,
                media_type AS "mediaType", status, created_at
         FROM miss_record
         WHERE ${where.sql}
         ORDER BY created_at DESC
         LIMIT ${EXPORT_LIMIT}`,
        where.params,
      );
      return result.rows;
    } finally {
      await pool.end();
    }
  }

  /** JSON 导出条目（投影 + userid 掩码） */
  async queryItems(days = 90, range?: MissRange): Promise<MissExportItem[]> {
    return toExportItems(await this.queryRecords(days, range));
  }

  /**
   * 流式 xlsx 导出：使用 pg cursor 逐批 fetch，逐行写入 WorkbookWriter，
   * 内存中始终只保持一个批次的数据。
   * 客户端提前断开导致的流错误被捕获并降级为 WARN，不向上抛出。
   */
  async exportXlsx(days: number, res: NodeJS.WritableStream & { setHeader?: (k: string, v: string) => void }, range?: MissRange): Promise<void> {
    const cfg = ConfigService.instance;
    const now = new Date();
    const from = range?.from ? new Date(range.from) : new Date(now.getTime() - days * 86400000);
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

    res.setHeader?.('Content-Type', XLSX_MIME);
    res.setHeader?.('Content-Disposition', `attachment; filename="miss-records_${ymd(from)}_${ymd(now)}.xlsx"`);

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res as unknown as Writable });
    const sheet = workbook.addWorksheet('miss-records', { properties: { defaultRowHeight: 15 } });
    const headerRow = sheet.addRow([...HEADER]);
    headerRow.font = { bold: true };

    const pool = new Pool({ connectionString: cfg.DATABASE_URL });
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const where = buildWhere(days, range);
      await client.query(`DECLARE cur CURSOR FOR
        SELECT trace_id, chat_id, user_id, question, score, engine,
               media_type AS "mediaType", status, created_at
        FROM miss_record
        WHERE ${where.sql}
        ORDER BY created_at DESC
        LIMIT ${EXPORT_LIMIT}`, where.params);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await client.query<Record<string, unknown>>(`FETCH ${FETCH_BATCH} FROM cur`);
        if (batch.rows.length === 0) break;
        for (const row of batch.rows) {
          sheet.addRow([
            row.trace_id,
            row.chat_id,
            maskPII(String(row.user_id), 'userid'),
            row.question,
            row.score,
            row.engine,
            row.mediaType ?? '',
            row.status,
            row.created_at,
          ]);
        }
        if (batch.rows.length < FETCH_BATCH) break;
      }
      await client.query('CLOSE cur');
      await workbook.commit();
    } catch (err) {
      this.warn({ detail: 'xlsx-stream-error', err: (err as Error).message });
      await workbook.commit().catch((e: unknown) => this.warn({ detail: 'xlsx-commit-fallback', err: (e as Error).message }));
    } finally {
      if (client) {
        try { await client.release(); } catch { /* */ }
      }
      try { await pool.end(); } catch { /* */ }
    }
  }

  private warn(obj: Record<string, unknown>): void {
    // Lazy import to avoid circular logger init
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppLogger } = require('../common/logger.js') as { AppLogger: new (tag: string) => { warn: (o: Record<string, unknown>) => void } };
    new AppLogger('MissExportService').warn(obj);
  }
}
