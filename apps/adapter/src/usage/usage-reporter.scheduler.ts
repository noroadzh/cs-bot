/**
 * 用量上报（D10）：每日 02:30
 * - 通用 webhook（USAGE_WEBHOOK_URL，可选）
 * - 控制面 POST /platform/report（CONTROL_PLANE_URL，可选）：仅计数、无正文
 * - 控制面失败：本地缓冲最多 7 天，下次重试；不影响问答
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from '../config/config.service.js';
import { UsageWebhookService } from './usage-webhook.service.js';
import { UsageService, type UsageCounters } from './usage.service.js';
import { CapacityUsageService, type CapacitySnapshot } from './capacity-usage.service.js';

const BUFFER_TTL_MS = 7 * 86_400_000;
const BUFFER_FILE = join(process.cwd(), 'data', 'report-buffer.json');

export function buildControlPlanePayload(
  tenantId: string,
  counters: UsageCounters,
  now = new Date(),
  capacity?: CapacitySnapshot,
): Record<string, unknown> {
  return {
    tenantId,
    date: now.toISOString().slice(0, 10),
    msgsIn: counters.messagesReceived,
    triggered: counters.messagesTriggered,
    hit: counters.messagesAnswered,
    miss: counters.messagesMissed,
    tokens: counters.tokensPrimary + counters.tokensFallback,
    activeChats: capacity?.activeChats ?? 0,
    docCount: capacity?.docCount ?? 0,
    qaCount: capacity?.qaCount ?? 0,
    assetMb: capacity?.assetMb ?? 0,
  };
}

export interface BufferedReport {
  payload: Record<string, unknown>;
  ts: number;
}

export function pruneBuffer(entries: BufferedReport[], nowMs = Date.now()): BufferedReport[] {
  return entries.filter((e) => nowMs - e.ts <= BUFFER_TTL_MS);
}

@Injectable()
export class UsageReporterScheduler {
  private readonly logger = new Logger(UsageReporterScheduler.name);

  constructor(
    private readonly webhook: UsageWebhookService,
    private readonly usage: UsageService,
    private readonly capacity?: CapacityUsageService,
  ) {}

  @Cron('30 2 * * *', { timeZone: 'Asia/Shanghai' })
  async reportDaily(): Promise<void> {
    const cfg = ConfigService.instance;
    if (cfg.USAGE_WEBHOOK_URL) {
      this.logger.log({ phase: 'cron', detail: 'daily usage webhook' });
      await this.webhook.report();
    }
    if (!cfg.CONTROL_PLANE_URL) return;
    await this.flushBuffer(cfg.CONTROL_PLANE_URL);
    const capacity = this.capacity ? await this.capacity.snapshot() : undefined;
    const payload = buildControlPlanePayload(cfg.TENANT_ID || '', this.usage.getUsage().counters, new Date(), capacity);
    try {
      await this.send(cfg.CONTROL_PLANE_URL, payload);
      this.logger.log({ phase: 'cron', detail: 'control-plane report sent' });
    } catch (err) {
      this.logger.warn({ phase: 'error', detail: 'control-plane report failed, buffered', err: (err as Error).message });
      await this.appendBuffer({ payload, ts: Date.now() });
    }
  }

  private async send(url: string, payload: Record<string, unknown>): Promise<void> {
    const token = ConfigService.instance.CONTROL_PLANE_TOKEN;
    await axios.post(`${url.replace(/\/$/, '')}/platform/report`, payload, {
      timeout: 10_000,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  }

  private async readBuffer(): Promise<BufferedReport[]> {
    try {
      const raw = await fs.readFile(BUFFER_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BufferedReport[]) : [];
    } catch {
      return [];
    }
  }

  private async writeBuffer(entries: BufferedReport[]): Promise<void> {
    try {
      await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
      await fs.writeFile(BUFFER_FILE, JSON.stringify(pruneBuffer(entries)), { mode: 0o600 });
    } catch (err) {
      this.logger.warn({ detail: 'report-buffer-write-failed', err: (err as Error).message });
    }
  }

  private async appendBuffer(entry: BufferedReport): Promise<void> {
    const entries = await this.readBuffer();
    entries.push(entry);
    await this.writeBuffer(entries);
  }

  private async flushBuffer(url: string): Promise<void> {
    const entries = pruneBuffer(await this.readBuffer());
    if (entries.length === 0) {
      await this.writeBuffer([]);
      return;
    }
    const remaining: BufferedReport[] = [];
    for (const e of entries) {
      try {
        await this.send(url, e.payload);
      } catch {
        remaining.push(e);
      }
    }
    await this.writeBuffer(remaining);
  }
}
