/**
 * 企微会话存档 → 规范化入 import 管道 + 在线质检
 */
import { Injectable } from '@nestjs/common';
import { AppLogger } from '../common/logger.js';

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

  enqueue(messages: readonly ArchiveMessage[]): { jobId: string; count: number } {
    const jobId = `archive-${Date.now()}`;
    this.jobs.push({ id: jobId, count: messages.length, createdAt: new Date().toISOString() });
    this.logger.log({ detail: 'archive-enqueued', jobId, count: messages.length });
    return { jobId, count: messages.length };
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
