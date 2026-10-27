/**
 * PlatformMonitor — 实例指标聚合与平台总览（概设 §5 M11 监控聚合）
 *
 * 健康来源与重启动作经接口注入，便于单测。
 */
import axios from 'axios';
import { Pool } from 'pg';
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

export class PlatformMonitor {
  constructor(
    private readonly source: HealthSource,
    private readonly restart?: (tenantId: string) => Promise<void>,
  ) {}

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
}


/**
 * 生产健康源：按 tenant.host 探测 `PLATFORM_HEALTH_URL_TEMPLATE`（{host} 占位）。
 * 失败（网络/非 200）视为不健康；实例指标无法从 healthz 获取时按 0 计。
 */
export class HttpHealthSource implements HealthSource {
  private readonly pool: Pool;

  constructor(
    connectionString: string,
    private readonly template: string,
    private readonly timeoutMs = 5000,
  ) {
    this.pool = new Pool({ connectionString, max: 2 });
  }

  async probe(tenantId: string): Promise<InstanceHealth> {
    try {
      const row = await this.pool.query<{ host: string | null }>(
        'SELECT host FROM tenant WHERE id = $1 AND deleted_at IS NULL',
        [tenantId],
      );
      const host = row.rows[0]?.host;
      if (!host) {
        return { tenantId, healthy: false, qaFailRate: 0, llmFailRate: 0 };
      }
      const url = this.template.replace('{host}', host);
      const resp = await axios.get(url, { timeout: this.timeoutMs });
      return {
        tenantId,
        healthy: resp.status === 200,
        qaFailRate: 0,
        llmFailRate: 0,
      };
    } catch {
      return { tenantId, healthy: false, qaFailRate: 0, llmFailRate: 0 };
    }
  }

  async close(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
