/**
 * 多模型路由：按名称/成本/延迟策略选路；跳过 unhealthy 端点
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export interface ModelEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  costPer1k?: number;
  latencyMs?: number;
  kind?: 'chat' | 'lora' | 'vllm';
  artifactUri?: string;
  /** 健康探测路径，默认 /health */
  probePath?: string;
}

export interface ModelEndpointState extends ModelEndpoint {
  healthy: boolean;
  failStreak: number;
  lastProbeAt?: string;
  lastError?: string;
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new AppLogger('ModelRouterService');
  private catalog: ModelEndpointState[] = [];
  private readonly failThreshold: number;

  constructor(_config: ConfigService) {
    this.failThreshold = ConfigService.instance.MODEL_PROBE_FAIL_THRESHOLD ?? 2;
    this.reloadFromEnv();
  }

  reloadFromEnv(): void {
    try {
      const raw = ConfigService.instance.MODEL_CATALOG_JSON || '[]';
      const parsed = JSON.parse(raw) as ModelEndpoint[];
      this.catalog = Array.isArray(parsed)
        ? parsed.map((e) => ({ ...e, healthy: true, failStreak: 0 }))
        : [];
    } catch {
      this.catalog = [];
    }
  }

  list(): ModelEndpointState[] {
    return this.catalog.map((e) => ({ ...e }));
  }

  register(endpoint: ModelEndpoint): ModelEndpointState {
    const existing = this.catalog.findIndex((e) => e.id === endpoint.id);
    const state: ModelEndpointState = {
      ...endpoint,
      healthy: existing >= 0 ? this.catalog[existing].healthy : true,
      failStreak: existing >= 0 ? this.catalog[existing].failStreak : 0,
      lastProbeAt: existing >= 0 ? this.catalog[existing].lastProbeAt : undefined,
      lastError: existing >= 0 ? this.catalog[existing].lastError : undefined,
    };
    if (existing >= 0) this.catalog[existing] = state;
    else this.catalog.push(state);
    this.logger.log({ detail: 'model-registered', modelId: endpoint.id, kind: endpoint.kind });
    return { ...state };
  }

  markProbeResult(id: string, ok: boolean, err?: string): void {
    const ep = this.catalog.find((e) => e.id === id);
    if (!ep) return;
    ep.lastProbeAt = new Date().toISOString();
    if (ok) {
      ep.failStreak = 0;
      ep.healthy = true;
      ep.lastError = undefined;
      return;
    }
    ep.failStreak += 1;
    ep.lastError = err;
    if (ep.failStreak >= this.failThreshold) {
      ep.healthy = false;
      this.logger.warn({ detail: 'model-unhealthy', modelId: id, failStreak: ep.failStreak });
    }
  }

  /** 仅健康端点参与选路（显式 name/id 命中时若 unhealthy 仍返回 null） */
  pick(policy: 'latency' | 'cost' | 'name' = 'latency', name?: string): ModelEndpoint | null {
    const healthy = this.catalog.filter((e) => e.healthy);
    if (name) {
      const hit = healthy.find((e) => e.name === name || e.id === name);
      return hit ? publicEndpoint(hit) : null;
    }
    if (healthy.length === 0) return null;
    const sorted = [...healthy].sort((a, b) => {
      if (policy === 'cost') return (a.costPer1k ?? 999) - (b.costPer1k ?? 999);
      return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
    });
    return sorted[0] ? publicEndpoint(sorted[0]) : null;
  }

  pickFallback(failedId: string): ModelEndpoint | null {
    const hit = this.catalog.find((e) => e.id !== failedId && e.healthy);
    return hit ? publicEndpoint(hit) : null;
  }
}

function publicEndpoint(e: ModelEndpointState): ModelEndpoint {
  const { healthy: _h, failStreak: _f, lastProbeAt: _t, lastError: _e, ...rest } = e;
  return rest;
}
