/**
 * PlatformMonitor — 实例指标聚合与平台总览（概设 §5 M11 监控聚合）
 *
 * 健康来源与重启动作经接口注入，便于单测。
 */
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
