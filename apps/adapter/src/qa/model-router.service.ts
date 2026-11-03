/**
 * 多模型路由：按名称/成本/延迟策略选路，与 MODEL_MODE 并存
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
}

@Injectable()
export class ModelRouterService {
  private readonly logger = new AppLogger('ModelRouterService');
  private catalog: ModelEndpoint[] = [];

  constructor(_config: ConfigService) {
    this.reloadFromEnv();
  }

  reloadFromEnv(): void {
    try {
      const raw = ConfigService.instance.MODEL_CATALOG_JSON || '[]';
      const parsed = JSON.parse(raw) as ModelEndpoint[];
      this.catalog = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.catalog = [];
    }
  }

  list(): ModelEndpoint[] {
    return [...this.catalog];
  }

  register(endpoint: ModelEndpoint): ModelEndpoint {
    const existing = this.catalog.findIndex((e) => e.id === endpoint.id);
    if (existing >= 0) this.catalog[existing] = endpoint;
    else this.catalog.push(endpoint);
    this.logger.log({ detail: 'model-registered', modelId: endpoint.id, kind: endpoint.kind });
    return endpoint;
  }

  /** 策略：优先 latency，其次 cost；失败时可 pickFallback */
  pick(policy: 'latency' | 'cost' | 'name' = 'latency', name?: string): ModelEndpoint | null {
    if (name) return this.catalog.find((e) => e.name === name || e.id === name) ?? null;
    if (this.catalog.length === 0) return null;
    const sorted = [...this.catalog].sort((a, b) => {
      if (policy === 'cost') return (a.costPer1k ?? 999) - (b.costPer1k ?? 999);
      return (a.latencyMs ?? 9999) - (b.latencyMs ?? 9999);
    });
    return sorted[0] ?? null;
  }

  pickFallback(failedId: string): ModelEndpoint | null {
    return this.catalog.find((e) => e.id !== failedId) ?? null;
  }
}
