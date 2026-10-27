/**
 * Usage counter service - in-memory counters with periodic snapshots
 */
import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { createEmptyCounters } from './usage-snapshot.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface UsageCounters {
  messagesReceived: number;
  messagesAnswered: number;
  messagesRefused: number;
  messagesMissed: number;
  assetsSent: number;
  tokensPrimary: number;
  tokensFallback: number;
  imagesReceived: number;
  imagesRecognized: number;
  imagesSkipped: number;
  messagesTriggered: number;
  /** 模型通道切云次数（增项 D） */
  llmFailovers: number;
  /** LLM 调用失败次数 */
  llmFailures: number;
  /** 群消息缺失 ChatId 被丢弃的条数 */
  messagesDroppedNoChatId: number;
}

export interface UsageSnapshot {
  period: 'daily' | 'weekly' | 'monthly';
  startedAt: string;
  counters: UsageCounters;
  generatedAt: string;
}

export type UsagePeriod = 'daily' | 'weekly' | 'monthly';

@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UsageService.name);
  private counters: UsageCounters = {
    messagesReceived: 0,
    messagesAnswered: 0,
    messagesRefused: 0,
    messagesMissed: 0,
    assetsSent: 0,
    tokensPrimary: 0,
    tokensFallback: 0,
    imagesReceived: 0,
    imagesRecognized: 0,
    imagesSkipped: 0,
    messagesTriggered: 0,
    llmFailovers: 0,
    llmFailures: 0,
    messagesDroppedNoChatId: 0,
  };
  private periodStart: Date;
  private currentPeriod: UsagePeriod;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private readonly SNAPSHOT_INTERVAL_MS = 60000; // 60 seconds
  private readonly SNAPSHOT_FILE = 'data/usage-snapshot.json';

  constructor() {
    this.periodStart = new Date();
    this.currentPeriod = ConfigService.instance.USAGE_PERIOD;
  }

  onModuleDestroy() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  async onModuleInit() {
    await this.restoreSnapshot();
    this.startSnapshotTimer();
    this.logger.log({
      phase: 'ready',
      detail: 'usage service',
      period: this.currentPeriod,
      startedAt: this.periodStart.toISOString(),
    });
  }

  /**
   * Increment a counter by 1 (or specified amount)
   */
  increment(key: keyof UsageCounters, amount: number = 1) {
    this.counters[key] += amount;
  }

  /**
   * Get current usage for a period
   */
  getUsage(period?: UsagePeriod): UsageSnapshot {
    const effectivePeriod = period || this.currentPeriod;
    this.checkPeriodReset(effectivePeriod);

    return {
      period: effectivePeriod,
      startedAt: this.periodStart.toISOString(),
      counters: { ...this.counters },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Estimate tokens from text (启发式估算)
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 2);
  }

  /**
   * Check if period changed and reset counters if needed
   */
  private checkPeriodReset(requestedPeriod?: UsagePeriod) {
    const now = new Date();
    const period = requestedPeriod || this.currentPeriod;
    let shouldReset = false;

    switch (period) {
      case 'daily':
        // Reset if different day
        shouldReset = now.toDateString() !== this.periodStart.toDateString();
        break;
      case 'weekly':
        // Reset if different week (Monday)
        const nowWeek = this.getWeekNumber(now);
        const startWeek = this.getWeekNumber(this.periodStart);
        shouldReset = nowWeek !== startWeek || now.getFullYear() !== this.periodStart.getFullYear();
        break;
      case 'monthly':
        // Reset if different month
        shouldReset = now.getMonth() !== this.periodStart.getMonth() || now.getFullYear() !== this.periodStart.getFullYear();
        break;
    }

    if (shouldReset) {
      this.logger.log({
        phase: 'period_reset',
        detail: 'usage counters reset',
        oldPeriod: this.currentPeriod,
        newPeriod: period,
      });
      this.counters = {
        messagesReceived: 0,
        messagesAnswered: 0,
        messagesRefused: 0,
        messagesMissed: 0,
        assetsSent: 0,
        tokensPrimary: 0,
        tokensFallback: 0,
        imagesReceived: 0,
        imagesRecognized: 0,
        imagesSkipped: 0,
        messagesTriggered: 0,
        llmFailovers: 0,
        llmFailures: 0,
        messagesDroppedNoChatId: 0,
      };
      this.periodStart = now;
      this.currentPeriod = period;
    }
  }

  /**
   * Get ISO week number
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }

  /**
   * Start periodic snapshot timer
   */
  private startSnapshotTimer() {
    this.snapshotInterval = setInterval(async () => {
      await this.saveSnapshot();
    }, this.SNAPSHOT_INTERVAL_MS);
  }

  /**
   * Save snapshot to disk
   */
  async saveSnapshot() {
    try {
      const snapshot: UsageSnapshot = {
        period: this.currentPeriod,
        startedAt: this.periodStart.toISOString(),
        counters: { ...this.counters },
        generatedAt: new Date().toISOString(),
      };

      const dir = path.dirname(this.SNAPSHOT_FILE);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');

      this.logger.debug({ phase: 'snapshot', detail: 'usage saved', counters: this.counters });
    } catch (err) {
      this.logger.error({ phase: 'error', detail: 'snapshot-save', err: (err as Error).message });
    }
  }

  /**
   * Restore snapshot from disk on startup
   */
  private async restoreSnapshot() {
    try {
      const data = await fs.readFile(this.SNAPSHOT_FILE, 'utf-8');
      const snapshot: UsageSnapshot = JSON.parse(data);

      // Only restore if period matches
      if (snapshot.period === this.currentPeriod) {
        // Merge with empty defaults so snapshots written before newer counters
        // existed restore as 0 instead of undefined (which would poison sums as NaN)
        this.counters = { ...createEmptyCounters(), ...snapshot.counters };
        this.periodStart = new Date(snapshot.startedAt);
        this.logger.log({
          phase: 'restore',
          detail: 'usage snapshot restored',
          period: snapshot.period,
          counters: this.counters,
        });
      } else {
        this.logger.log({
          phase: 'restore',
          detail: 'usage snapshot discarded (period mismatch)',
          snapshotPeriod: snapshot.period,
          currentPeriod: this.currentPeriod,
        });
      }
    } catch (err) {
      // File doesn't exist or parse error - this is fine for fresh start
      this.logger.debug({ phase: 'restore', detail: 'no usage snapshot found, starting fresh' });
    }
  }

  /**
   * Get current counters (for internal use)
   */
  getCounters(): UsageCounters {
    return { ...this.counters };
  }
}