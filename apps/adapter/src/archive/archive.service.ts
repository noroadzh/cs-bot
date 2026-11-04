/**
 * 企微会话存档 → 规范化入 import 管道 + 在线质检
 */
import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger.js';
import { ImportJobService } from '../import/import-job.service.js';

export interface ArchiveMessage {
  msgId: string;
  chatId: string;
  from: string;
  content: string;
  msgTime: number;
}

export interface QualityAlert {
  rule: 'sensitive' | 'refusal_rate' | 'latency';
  detail: string;
}

@Injectable()
export class ArchiveService {
  private readonly logger = new AppLogger('ArchiveService');
  private readonly jobs: Array<{ id: string; count: number; createdAt: string }> = [];
  private readonly alerts: QualityAlert[] = [];

  constructor(private readonly imports: ImportJobService) {}

  /**
   * 将存档消息写成 wecom-archive JSON 并创建 import_job（无需手工上传）。
   * 不在此同步 parse，避免抢问答热路径（R-8）。
   */
  async enqueue(
    messages: readonly ArchiveMessage[],
  ): Promise<{ jobId: string; count: number; reused: boolean }> {
    const payload = messages.map((m) => ({
      msgId: m.msgId,
      chatId: m.chatId,
      from: m.from,
      content: m.content,
      msgTime: m.msgTime,
    }));
    const stamp = Date.now();
    const created = await this.imports.createFromFile({
      filename: `archive-${stamp}.json`,
      mimeType: 'application/json',
      bytes: Buffer.from(JSON.stringify(payload), 'utf8'),
      name: `archive-${new Date(stamp).toISOString()}`,
    });
    const jobId = created.job.id;
    this.jobs.push({ id: jobId, count: messages.length, createdAt: new Date().toISOString() });
    this.logger.log({
      detail: 'archive-enqueued',
      jobId,
      count: messages.length,
      reused: created.reused,
    });
    return { jobId, count: messages.length, reused: created.reused };
  }

  runQualityChecks(sample: {
    sensitiveHits: number;
    refusals: number;
    total: number;
    p95LatencyMs: number;
  }): QualityAlert[] {
    const out: QualityAlert[] = [];
    if (sample.sensitiveHits > 0) {
      out.push({ rule: 'sensitive', detail: `hits=${sample.sensitiveHits}` });
    }
    if (sample.total > 0 && sample.refusals / sample.total > 0.5) {
      out.push({ rule: 'refusal_rate', detail: `rate=${(sample.refusals / sample.total).toFixed(2)}` });
    }
    if (sample.p95LatencyMs > 8_000) {
      out.push({ rule: 'latency', detail: `p95=${sample.p95LatencyMs}` });
    }
    this.alerts.push(...out);
    for (const a of out) this.logger.warn({ detail: 'archive-quality', rule: a.rule });
    return out;
  }

  listJobs() {
    return this.jobs;
  }

  listAlerts() {
    return this.alerts;
  }
}
