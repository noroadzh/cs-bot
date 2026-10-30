/**
 * PlatformMonitor — 实例指标聚合与平台总览（概设 §5 M11 监控聚合）
 *
 * 健康来源与重启动作经接口注入，便于单测。
 */
import axios from 'axios';
import https from 'node:https';
import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { AppLogger } from '../common/logger.js';
import type { PlatformAuditAction } from './tenant.entity.js';
export interface InstanceHealth {
  tenantId: string;
  healthy: boolean;
  qaFailRate: number;
  llmFailRate: number;
  cpuPct?: number;
  memPct?: number;
}

export interface HealthSource {
  probe(tenantId: string): Promise<InstanceHealth>;
}

export interface PlatformOverview {
  tenantCount: number;
  healthy: number;
  unhealthy: string[];
  avgQaFailRate: number;
  avgLlmFailRate: number;
}

export interface MonitorAudit {
  append(entry: {
    action: PlatformAuditAction;
    actor: string;
    tenantId: string | null;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface MonitorOptions {
  /** 巡检间隔；<=0 关闭周期巡检 */
  intervalMs?: number;
  /** 连续失败多少次后重启 */
  failureThreshold?: number;
  /** 每租户每小时最多重启次数 */
  maxRestartsPerHour?: number;
  /** 告警去重窗口 */
  alertWindowMs?: number;
  /** 资源水位告警阈值（%） */
  resourceAlertPct?: number;
  /** 连续多少次超过阈值才告警 */
  resourceAlertStreak?: number;
  /** 租户 id 列表（周期巡检必需） */
  listTenants?: () => Promise<string[]>;
  now?: () => number;
}

export class PlatformMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('PlatformMonitor');
  private readonly intervalMs: number;
  private readonly failureThreshold: number;
  private readonly maxRestartsPerHour: number;
  private readonly alertWindowMs: number;
  private readonly listTenants?: () => Promise<string[]>;
  private readonly now: () => number;
  private readonly resourceAlertPct: number;
  private readonly resourceAlertStreak: number;
  private readonly resourceHits = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly failures = new Map<string, number>();
  private readonly restarts = new Map<string, number[]>();
  private readonly lastAlert = new Map<string, number>();

  constructor(
    private readonly source: HealthSource,
    private readonly restart?: (tenantId: string) => Promise<void>,
    private readonly audit?: MonitorAudit,
    opts: MonitorOptions = {},
  ) {
    this.intervalMs = opts.intervalMs ?? 60_000;
    this.failureThreshold = Math.max(opts.failureThreshold ?? 2, 1);
    this.maxRestartsPerHour = Math.max(opts.maxRestartsPerHour ?? 3, 0);
    this.alertWindowMs = opts.alertWindowMs ?? 3_600_000;
    this.resourceAlertPct = Math.min(Math.max(opts.resourceAlertPct ?? 90, 1), 100);
    this.resourceAlertStreak = Math.max(opts.resourceAlertStreak ?? 3, 1);
    this.listTenants = opts.listTenants;
    this.now = opts.now ?? (() => Date.now());
  }

  onModuleInit(): void {
    if (this.intervalMs <= 0 || !this.listTenants) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async collect(tenantIds: readonly string[]): Promise<{
    overview: PlatformOverview;
    instances: InstanceHealth[];
  }> {
    const instances: InstanceHealth[] = [];
    for (const id of tenantIds) {
      instances.push(await this.source.probe(id));
    }
    const unhealthy = instances.filter((i) => !i.healthy).map((i) => i.tenantId);
    const n = instances.length || 1;
    const overview: PlatformOverview = {
      tenantCount: instances.length,
      healthy: instances.filter((i) => i.healthy).length,
      unhealthy,
      avgQaFailRate: instances.reduce((s, i) => s + i.qaFailRate, 0) / n,
      avgLlmFailRate: instances.reduce((s, i) => s + i.llmFailRate, 0) / n,
    };
    return { overview, instances };
  }

  /** 周期巡检：连续失败达阈值才重启，并遵守每小时上限与告警去重 */
  async tick(): Promise<void> {
    if (this.running || !this.listTenants) return;
    this.running = true;
    try {
      const ids = await this.listTenants();
      if (ids.length === 0) return;
      const { instances } = await this.collect(ids);
      const now = this.now();
      for (const inst of instances) {
        const id = inst.tenantId;
        await this.checkResourceWater(inst);
        if (inst.healthy) {
          this.failures.delete(id);
          continue;
        }
        const failures = (this.failures.get(id) ?? 0) + 1;
        this.failures.set(id, failures);
        if (failures < this.failureThreshold) continue;

        if (!this.restart) {
          await this.alert(id, 'unhealthy_no_restart_handler');
          continue;
        }
        const history = (this.restarts.get(id) ?? []).filter((t) => now - t < 3_600_000);
        if (history.length >= this.maxRestartsPerHour) {
          await this.alert(id, 'restart_limit_reached', { restartsLastHour: history.length });
          continue;
        }
        try {
          await this.restart(id);
          history.push(now);
          this.restarts.set(id, history);
          this.failures.set(id, 0);
          await this.audit?.append({
            action: 'tenant.restart',
            actor: 'system:monitor',
            tenantId: id,
            payload: { consecutiveFailures: failures },
          });
          this.logger.warn({ detail: 'instance-restarted', tenantId: id, consecutiveFailures: failures });
        } catch (err) {
          await this.alert(id, 'restart_failed', { err: (err as Error).message });
        }
      }
    } catch (err) {
      this.logger.error({ detail: 'monitor-tick-failed', err: (err as Error).message });
    } finally {
      this.running = false;
    }
  }

  /** 资源水位：连续 N 次超阈值告警一次（不重启） */
  private async checkResourceWater(inst: InstanceHealth): Promise<void> {
    const cpu = inst.cpuPct ?? 0;
    const mem = inst.memPct ?? 0;
    const over = cpu >= this.resourceAlertPct || mem >= this.resourceAlertPct;
    if (!over) {
      this.resourceHits.delete(inst.tenantId);
      return;
    }
    const hits = (this.resourceHits.get(inst.tenantId) ?? 0) + 1;
    if (hits < this.resourceAlertStreak) {
      this.resourceHits.set(inst.tenantId, hits);
      return;
    }
    this.resourceHits.set(inst.tenantId, 0);
    await this.alert(inst.tenantId, 'resource_high', {
      cpuPct: cpu,
      memPct: mem,
      thresholdPct: this.resourceAlertPct,
      streak: hits,
    });
  }

  /** 对异常实例执行重启（若注入了重启动作） */
  async remediate(unhealthy: readonly string[]): Promise<string[]> {
    if (!this.restart) return [];
    const restarted: string[] = [];
    for (const id of unhealthy) {
      try {
        await this.restart(id);
        restarted.push(id);
      } catch {
        /* best-effort */
      }
    }
    return restarted;
  }

  private async alert(
    tenantId: string,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const now = this.now();
    const last = this.lastAlert.get(tenantId) ?? 0;
    if (now - last < this.alertWindowMs) return;
    this.lastAlert.set(tenantId, now);
    this.logger.error({ detail: 'instance-alert', tenantId, reason, ...extra });
    await this.audit?.append({
      action: 'tenant.alert',
      actor: 'system:monitor',
      tenantId,
      payload: { reason, ...extra },
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await (this.source as { close?: () => Promise<void> }).close?.().catch(() => undefined);
  }
}


/**
 * 生产健康源：按 tenant.host 探测 `PLATFORM_HEALTH_URL_TEMPLATE`（{host} 占位）。
 * 失败（网络/非 200）视为不健康；实例指标无法从 healthz 获取时按 0 计。
 */
/** 从 healthz.usage 计算失败率 */
export function buildHealthUrl(host: string, port: number, scheme = 'https'): string {
  return `${scheme}://${host}:${port}/healthz`;
}

export function computeFailRates(usage?: {
  messagesReceived?: number;
  messagesMissed?: number;
  llmFailures?: number;
}): { qaFailRate: number; llmFailRate: number } {
  const received = Number(usage?.messagesReceived ?? 0);
  if (received <= 0) return { qaFailRate: 0, llmFailRate: 0 };
  return {
    qaFailRate: Number(usage?.messagesMissed ?? 0) / received,
    llmFailRate: Number(usage?.llmFailures ?? 0) / received,
  };
}

export class HttpHealthSource implements HealthSource {
  private readonly pool: Pool;

  constructor(
    connectionString: string,
    private readonly opts: {
      scheme?: string;
      verifyTls?: boolean;
      timeoutMs?: number;
    } = {},
  ) {
    this.pool = new Pool({ connectionString, max: 2 });
  }

  async probe(tenantId: string): Promise<InstanceHealth> {
    try {
      const row = await this.pool.query<{ host: string | null; port: number | null }>(
        'SELECT host, port FROM tenant WHERE id = $1 AND deleted_at IS NULL',
        [tenantId],
      );
      const host = row.rows[0]?.host;
      const port = Number(row.rows[0]?.port ?? 0);
      if (!host || !port) {
        return { tenantId, healthy: false, qaFailRate: 0, llmFailRate: 0 };
      }
      const scheme = this.opts.scheme ?? 'https';
      const url = buildHealthUrl(host, port, scheme);
      const httpsAgent =
        scheme === 'https'
          ? new https.Agent({ rejectUnauthorized: this.opts.verifyTls !== false })
          : undefined;
      const resp = await axios.get(url, {
        timeout: this.opts.timeoutMs ?? 5000,
        httpsAgent,
      });
      const rates = computeFailRates(resp.data?.usage);
      const res = resp.data?.resources as { cpuPct?: unknown; memPct?: unknown } | undefined;
      return {
        tenantId,
        healthy: resp.status === 200,
        ...rates,
        cpuPct: typeof res?.cpuPct === 'number' ? res.cpuPct : undefined,
        memPct: typeof res?.memPct === 'number' ? res.memPct : undefined,
      };
    } catch {
      return { tenantId, healthy: false, qaFailRate: 0, llmFailRate: 0 };
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
