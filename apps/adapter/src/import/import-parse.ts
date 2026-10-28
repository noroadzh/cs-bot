/**
 * 导入解析：文件嗅探、流式解析、清洗配对与条目入库
 */
import { promises as fs } from 'fs';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { Pool } from 'pg';
import { StreamingQaPairing, type PairedItem } from './qa-pairing.js';
import { MissingColumnError, UnsupportedFormatError } from './import-parser.js';
import type { ImportCleaner, CleanMessage } from './import-cleaner.js';
import { sniffShapeHead, UnrecognizedShapeError, type ImportShape } from './content-sniffer.js';
import { readXlsxHeaderFromFile, streamConversationMessages, streamQaPairs } from './message-stream.js';
import { getJob, getJobRow } from './import-query.js';
import type { ImportJob, ImportJobRow } from './import-job.entity.js';

export interface ParseHost {
  pool: Pool;
  logger: AppLogger;
  getCleaner(): ImportCleaner;
  guardMemory(): Promise<void>;
  updateStatus(jobId: string, status: ImportJob['status'], itemCount?: number): Promise<void>;
  failJob(jobId: string, message: string): Promise<ImportJob>;
  persistItems(
    jobId: string,
    rows: readonly { question: string; answer: string; conversationId?: string; occurredAt?: number }[],
  ): Promise<{ inserted: number; dedup: number }>;
  persistUnpaired(jobId: string, messages: readonly CleanMessage[]): Promise<void>;
  updateStageCounts(
    jobId: string,
    totalMessages: number,
    cleaned: number,
    paired: number,
    unpaired: number,
  ): Promise<void>;
  updateMessageCounters(jobId: string, totalMessages: number, parsedMessages: number): Promise<void>;
  countStoredItems(jobId: string): Promise<number>;
}

/** 只读文件头（默认 64KB），避免大文件整读 */
async function readHead(path: string, size = 64 * 1024): Promise<Buffer> {
  const fh = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(size);
    const { bytesRead } = await fh.read(buf, 0, size, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function runParseJob(host: ParseHost, jobId: string): Promise<ImportJob> {
    const job = await getJobRow(host.pool, jobId);
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
      return host.failJob(jobId, 'stored file path missing');
    }
    const mimeType = job.mimeType ?? '';

    await host.updateStatus(jobId, 'parsing');

    let bytes: Buffer | null = null;
    let head: Buffer;
    let xlsxHeader: string[] | undefined;
    try {
      head = await readHead(storedPath);
      if (mimeType.includes('spreadsheetml')) {
        xlsxHeader = await readXlsxHeaderFromFile(storedPath);
      }
    } catch (err) {
      return host.failJob(jobId, `read failed: ${(err as Error).message}`);
    }
    await host.guardMemory();

    let shape: ImportShape;
    try {
      shape = sniffShapeHead(head, mimeType, xlsxHeader);
    } catch (err) {
      if (err instanceof UnrecognizedShapeError) return host.failJob(jobId, err.message);
      return host.failJob(jobId, `sniff failed: ${(err as Error).message}`);
    }
    await host.pool.query('UPDATE import_job SET source_shape = $2 WHERE id = $1', [jobId, shape]);

    // JSON/CSV 会话形态：流式解析 + 暂存排序 + 增量配对（不全量入内存）
    if (shape === 'conversation-table' || shape === 'wecom-archive') {
      return parseConversationStreaming(host, jobId, storedPath, mimeType, shape);
    }

    // qa-pairs（直接成对）：流式解析 + 分批入库
    let count = 0;
    try {
      let batch: { question: string; answer: string }[] = [];
      for await (const row of streamQaPairs(storedPath, mimeType)) {
        batch.push(row);
        count += 1;
        if (count > (ConfigService.instance.IMPORT_MAX_MESSAGES ?? 50000)) {
          return host.failJob(jobId, `too many messages: > ${ConfigService.instance.IMPORT_MAX_MESSAGES}`);
        }
        if (batch.length >= 1000) {
          await host.persistItems(jobId, batch);
          batch = [];
        }
        if (count % 2000 === 0) await host.guardMemory();
      }
      if (batch.length > 0) await host.persistItems(jobId, batch);
    } catch (err) {
      if (err instanceof UnsupportedFormatError || err instanceof MissingColumnError) {
        return host.failJob(jobId, err.message);
      }
      if (err instanceof SyntaxError) return host.failJob(jobId, err.message);
      return host.failJob(jobId, `parse failed: ${(err as Error).message}`);
    }

    const stored = await host.countStoredItems(jobId);
    await host.updateMessageCounters(jobId, count, count);
    await host.updateStatus(jobId, 'parsed', stored);
    host.logger.log({ detail: 'import-parsed', jobId, shape, streaming: true, items: stored });
    return (await getJob(host.pool, jobId))!;
  }

  /** JSON/CSV/XLSX 会话流式导入：头部嗅探 → 逐条清洗 → 暂存表 → 游标增量配对 */
async function parseConversationStreaming(
  host: ParseHost,
  jobId: string,
    storedPath: string,
    mimeType: string,
    shape: ImportShape,
  ): Promise<ImportJob> {
    const max = ConfigService.instance.IMPORT_MAX_MESSAGES ?? 50000;
    const streamCleaner = host.getCleaner().stream();
    const gap = (ConfigService.instance.IMPORT_PAIR_GAP_MINUTES ?? 30) * 60_000;
    const minAnswer = ConfigService.instance.IMPORT_MIN_ANSWER_CHARS ?? 6;
    const pairing = new StreamingQaPairing(gap, minAnswer);
    let totalMessages = 0;
    let cleaned = 0;
    let pairedCount = 0;
    let unpairedCount = 0;

    const flushStage = async (batch: CleanMessage[]): Promise<void> => {
      if (batch.length === 0) return;
      const values: string[] = [];
      const params: unknown[] = [jobId];
      batch.forEach((m, i) => {
        const base = 2 + i * 5;
        values.push(`($1, $${base}, $${base + 1}, $${base + 2}, $${base + 3}, to_timestamp($${base + 4} / 1000.0))`);
        params.push(m.conversationId, m.senderId, m.senderType, m.content, m.occurredAt);
      });
      await host.pool.query(
        `INSERT INTO import_message_stage
           (job_id, conversation_id, sender_id, sender_type, content, occurred_at)
         VALUES ${values.join(',')}`,
        params,
      );
    };

    try {
      await host.pool.query('DELETE FROM import_message_stage WHERE job_id = $1', [jobId]);
      let stageBatch: CleanMessage[] = [];
      for await (const raw of streamConversationMessages(storedPath, mimeType, shape, jobId)) {
        totalMessages += 1;
        const m = streamCleaner.push(raw);
        if (!m) continue;
        cleaned += 1;
        if (cleaned > max) throw new Error(`too many messages: > ${max}`);
        stageBatch.push(m);
        if (stageBatch.length >= 500) {
          await flushStage(stageBatch);
          stageBatch = [];
        }
        if (cleaned % 2000 === 0) await host.guardMemory();
      }
      await flushStage(stageBatch);

      const client = await host.pool.connect();
      let pairedBatch: PairedItem[] = [];
      let unpairedBatch: CleanMessage[] = [];
      const flushPairs = async (): Promise<void> => {
        if (pairedBatch.length > 0) {
          await host.persistItems(jobId, pairedBatch);
          pairedCount += pairedBatch.length;
          pairedBatch = [];
        }
        if (unpairedBatch.length > 0) {
          await host.persistUnpaired(jobId, unpairedBatch);
          unpairedCount += unpairedBatch.length;
          unpairedBatch = [];
        }
      };
      try {
        await client.query('BEGIN');
        await client.query(
          `DECLARE cur CURSOR FOR
             SELECT conversation_id, sender_id, sender_type, content, occurred_at
             FROM import_message_stage
             WHERE job_id = '${jobId}'
             ORDER BY conversation_id, occurred_at, id`,
        );
        for (;;) {
          const res = await client.query<{
            conversation_id: string; sender_id: string; sender_type: string;
            content: string; occurred_at: Date;
          }>('FETCH 1000 FROM cur');
          if (res.rows.length === 0) break;
          for (const r of res.rows) {
            pairing.push({
              conversationId: r.conversation_id,
              senderId: r.sender_id,
              senderType: r.sender_type as CleanMessage['senderType'],
              content: r.content,
              occurredAt: new Date(r.occurred_at).getTime(),
            });
            const drained = pairing.drain();
            pairedBatch.push(...drained.paired);
            unpairedBatch.push(...drained.unpaired);
            if (pairedBatch.length >= 1000 || unpairedBatch.length >= 1000) await flushPairs();
          }
        }
        pairing.finish();
        const drained = pairing.drain();
        pairedBatch.push(...drained.paired);
        unpairedBatch.push(...drained.unpaired);
        await flushPairs();
        await client.query('CLOSE cur');
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        await client.query('DELETE FROM import_message_stage WHERE job_id = $1', [jobId]).catch(() => undefined);
        client.release();
      }

      await host.updateStageCounts(jobId, totalMessages, cleaned, pairedCount, unpairedCount);
      const stored = await host.countStoredItems(jobId);
      await host.updateStatus(jobId, 'parsed', stored);
      host.logger.log({
        detail: 'import-parsed', jobId, shape, streaming: true,
        totalMessages, cleaned, paired: pairedCount, unpaired: unpairedCount,
      });
      return (await getJob(host.pool, jobId))!;
    } catch (err) {
      await host.pool.query('DELETE FROM import_message_stage WHERE job_id = $1', [jobId]).catch(() => undefined);
      return host.failJob(jobId, `stream parse failed: ${(err as Error).message}`);
    }
  }
