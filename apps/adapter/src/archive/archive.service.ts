/**
 * 企微会话存档 → 规范化入 import 管道 + 在线质检（持久化）
 */
import { Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { createHash } from 'crypto';
import { AppLogger } from '../common/logger.js';
import { OpsAlertService } from '../common/ops-alert.service.js';
import { currentTenantId } from '../common/tenant-scope.js';
import { ConfigService } from '../config/config.service.js';
import { ImportJobService } from '../import/import-job.service.js';
import { WecomSessionArchiveClient } from './wecom-session-archive.client.js';

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

export interface QualitySample {
  sensitiveHits: number;
  refusals: number;
  total: number;
  p95LatencyMs: number;
  windowLabel?: string;
}

export interface QualityInspectionRow {
  id: number | string;
  sensitiveHits: number;
  refusals: number;
  total: number;
  p95LatencyMs: number;
  alerts: QualityAlert[];
  windowLabel: string;
  createdAt: string;
}

@Injectable()
export class ArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('ArchiveService');
  private readonly jobs: Array<{ id: string; count: number; createdAt: string; sourceHash?: string }> =
    [];
  private readonly memoryInspections: QualityInspectionRow[] = [];
  private readonly seenMsgIds = new Set<string>();
  private readonly pool: Pool;
  private readonly ops: OpsAlertService;
  private readonly client: WecomSessionArchiveClient;
  private pullCursor = '';
  private pullInFlight = false;
  private lastPullAt?: string;
  private lastPullError?: string;
  private pullTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly imports: ImportJobService,
    @Optional() pool?: Pool,
    @Optional() ops?: OpsAlertService,
    @Optional() client?: WecomSessionArchiveClient,
  ) {
    this.pool =
      pool ??
      new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 3 });
    this.ops = ops ?? new OpsAlertService();
    this.client = client ?? new WecomSessionArchiveClient();
  }

  onModuleInit(): void {
    const ms = ConfigService.instance.WECOM_ARCHIVE_PULL_INTERVAL_MS ?? 0;
    if (ms > 0 && this.client.enabled()) {
      this.pullTimer = setInterval(() => void this.pullOnce().catch(() => undefined), ms);
      this.pullTimer.unref?.();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pullTimer) clearInterval(this.pullTimer);
    await this.pool.end().catch(() => undefined);
  }

  /**
   * 将存档消息写成 wecom-archive JSON 并创建 import_job（无需手工上传）。
   * 不在此同步 parse，避免抢问答热路径（R-8）。
   */
  async enqueue(
    messages: readonly ArchiveMessage[],
  ): Promise<{ jobId: string; count: number; reused: boolean }> {
    const fresh = messages.filter((m) => m.msgId && !this.seenMsgIds.has(m.msgId));
    for (const m of fresh) this.seenMsgIds.add(m.msgId);
    if (fresh.length === 0 && messages.length > 0) {
      const hash = sourceHash(messages);
      const hit =
        this.jobs.find((j) => j.sourceHash === hash) ?? this.jobs[this.jobs.length - 1];
      return { jobId: hit?.id ?? 'reused', count: 0, reused: true };
    }
    const use = fresh.length ? fresh : messages;
    const payload = use.map((m) => ({
      msgId: m.msgId,
      chatId: m.chatId,
      from: m.from,
      content: m.content,
      msgTime: m.msgTime,
    }));
    const hash = sourceHash(use);
    const stamp = Date.now();
    const created = await this.imports.createFromFile({
      filename: `archive-${stamp}.json`,
      mimeType: 'application/json',
      bytes: Buffer.from(JSON.stringify(payload), 'utf8'),
      name: `archive-${new Date(stamp).toISOString()}`,
    });
    const jobId = created.job.id;
    this.jobs.push({
      id: jobId,
      count: use.length,
      createdAt: new Date().toISOString(),
      sourceHash: hash,
    });
    this.logger.log({
      detail: 'archive-enqueued',
      jobId,
      count: use.length,
      reused: created.reused,
    });
    return { jobId, count: use.length, reused: created.reused };
  }

  async pullOnce(): Promise<{
    errCode?: string;
    jobId?: string;
    count?: number;
    reused?: boolean;
  }> {
    if (!this.client.enabled()) return { errCode: 'ARCHIVE_PULL_DISABLED' };
    if (this.pullInFlight) return { errCode: 'ARCHIVE_PULL_BUSY' };
    this.pullInFlight = true;
    try {
      const batch = await this.client.pull(this.pullCursor);
      if (!batch.messages.length) {
        this.pullCursor = batch.nextCursor || this.pullCursor;
        this.lastPullAt = new Date().toISOString();
        this.lastPullError = undefined;
        return { count: 0, reused: false };
      }
      const enq = await this.enqueue(batch.messages);
      this.pullCursor = batch.nextCursor || this.pullCursor;
      this.lastPullAt = new Date().toISOString();
      this.lastPullError = undefined;
      return { jobId: enq.jobId, count: enq.count, reused: enq.reused };
    } catch (err) {
      const code = (err as Error & { errCode?: string }).errCode ?? 'ARCHIVE_SDK_AUTH_FAILED';
      this.lastPullError = code;
      return { errCode: code };
    } finally {
      this.pullInFlight = false;
    }
  }

  pullState() {
    return {
      enabled: this.client.enabled(),
      cursor: this.pullCursor,
      inFlight: this.pullInFlight,
      lastPullAt: this.lastPullAt,
      lastError: this.lastPullError,
    };
  }

  ingestCallback(
    messages: ArchiveMessage[],
    rawBody: string,
    signature?: string,
  ): Promise<{ jobId: string; count: number; reused: boolean } | { errCode: string }> {
    if (!this.client.verifyCallbackSignature(rawBody, signature)) {
      return Promise.resolve({ errCode: 'ARCHIVE_CALLBACK_SIGNATURE_INVALID' });
    }
    return this.enqueue(messages);
  }

  async runQualityChecks(sample: QualitySample): Promise<{
    inspectionId: string | number;
    alerts: QualityAlert[];
  }> {
    const alerts = this.evaluate(sample);
    const windowLabel = sample.windowLabel ?? '';
    const now = new Date().toISOString();
    let inspectionId: string | number = `mem-${Date.now()}`;

    try {
      const res = await this.pool.query(
        `INSERT INTO quality_inspection
           (tenant_id, sensitive_hits, refusals, total, p95_latency_ms, alerts, window_label)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
         RETURNING id`,
        [
          currentTenantId(),
          sample.sensitiveHits,
          sample.refusals,
          sample.total,
          sample.p95LatencyMs,
          JSON.stringify(alerts),
          windowLabel,
        ],
      );
      inspectionId = res.rows[0]?.id ?? inspectionId;
    } catch (err) {
      this.logger.warn({
        detail: 'quality-insert-fallback-memory',
        err: (err as Error).message,
      });
      this.memoryInspections.unshift({
        id: inspectionId,
        sensitiveHits: sample.sensitiveHits,
        refusals: sample.refusals,
        total: sample.total,
        p95LatencyMs: sample.p95LatencyMs,
        alerts,
        windowLabel,
        createdAt: now,
      });
    }

    for (const a of alerts) {
      this.logger.warn({ detail: 'archive-quality', rule: a.rule });
      const key = `quality:${a.rule}:${windowLabel || 'default'}`;
      await this.ops.alert(key, `quality ${a.rule} ${a.detail}`);
    }

    return { inspectionId, alerts };
  }

  async listInspections(opts: {
    limit?: number;
    rule?: string;
    from?: string;
    to?: string;
  } = {}): Promise<QualityInspectionRow[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    try {
      const params: unknown[] = [currentTenantId()];
      let sql = `SELECT id, sensitive_hits, refusals, total, p95_latency_ms, alerts, window_label, created_at
                   FROM quality_inspection
                  WHERE tenant_id = $1`;
      if (opts.from) {
        params.push(opts.from);
        sql += ` AND created_at >= $${params.length}`;
      }
      if (opts.to) {
        params.push(opts.to);
        sql += ` AND created_at <= $${params.length}`;
      }
      if (opts.rule) {
        params.push(JSON.stringify([{ rule: opts.rule }]));
        sql += ` AND alerts @> $${params.length}::jsonb`;
      }
      params.push(limit);
      sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const res = await this.pool.query(sql, params);
      return res.rows.map(mapInspectionRow);
    } catch {
      return this.memoryInspections
        .filter((r) => !opts.rule || r.alerts.some((a) => a.rule === opts.rule))
        .slice(0, limit);
    }
  }

  listJobs() {
    return this.jobs;
  }

  /** @deprecated 兼容旧调用；请用 listInspections */
  listAlerts(): QualityAlert[] {
    return this.memoryInspections.flatMap((i) => i.alerts);
  }

  private evaluate(sample: QualitySample): QualityAlert[] {
    const cfg = ConfigService.instance;
    const sensTh = cfg.QUALITY_SENSITIVE_HITS_THRESHOLD ?? 0;
    const refusalTh = cfg.QUALITY_REFUSAL_RATE_THRESHOLD ?? 0.5;
    const latencyTh = cfg.QUALITY_P95_LATENCY_MS_THRESHOLD ?? 8_000;
    const out: QualityAlert[] = [];
    if (sample.sensitiveHits > sensTh) {
      out.push({ rule: 'sensitive', detail: `hits=${sample.sensitiveHits}` });
    }
    if (sample.total > 0 && sample.refusals / sample.total > refusalTh) {
      out.push({
        rule: 'refusal_rate',
        detail: `rate=${(sample.refusals / sample.total).toFixed(2)}`,
      });
    }
    if (sample.p95LatencyMs > latencyTh) {
      out.push({ rule: 'latency', detail: `p95=${sample.p95LatencyMs}` });
    }
    return out;
  }
}

function sourceHash(messages: readonly ArchiveMessage[]): string {
  const key = messages.map((m) => m.msgId).sort().join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 32);
}

function mapInspectionRow(row: Record<string, unknown>): QualityInspectionRow {
  const alertsRaw = row.alerts;
  let alerts: QualityAlert[] = [];
  if (Array.isArray(alertsRaw)) alerts = alertsRaw as QualityAlert[];
  else if (typeof alertsRaw === 'string') {
    try {
      alerts = JSON.parse(alertsRaw) as QualityAlert[];
    } catch {
      alerts = [];
    }
  }
  return {
    id: row.id as number | string,
    sensitiveHits: Number(row.sensitive_hits ?? 0),
    refusals: Number(row.refusals ?? 0),
    total: Number(row.total ?? 0),
    p95LatencyMs: Number(row.p95_latency_ms ?? 0),
    alerts,
    windowLabel: String(row.window_label ?? ''),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at ?? ''),
  };
}
