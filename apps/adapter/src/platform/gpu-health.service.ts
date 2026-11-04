/**
 * GPU/vLLM 端点健康探测（不进消息热路径）
 */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '../config/config.service.js';
import { ModelRouterService } from '../qa/model-router.service.js';
import { AppLogger } from '../common/logger.js';

@Injectable()
export class GpuHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new AppLogger('GpuHealthService');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly router: ModelRouterService) {}

  onModuleInit(): void {
    const ms = ConfigService.instance.MODEL_PROBE_INTERVAL_MS ?? 30_000;
    if (ms <= 0) return;
    this.timer = setInterval(() => void this.probeAll(), ms);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async probeAll(): Promise<void> {
    for (const ep of this.router.list()) {
      if (ep.kind === 'lora' && !ep.baseUrl.startsWith('http')) continue;
      await this.probeOne(ep.id, ep.baseUrl, ep.probePath);
    }
  }

  async probeOne(id: string, baseUrl: string, probePath = '/health'): Promise<boolean> {
    if (!baseUrl.startsWith('http')) {
      this.router.markProbeResult(id, true);
      return true;
    }
    const url = `${baseUrl.replace(/\/+$/, '')}${probePath.startsWith('/') ? probePath : `/${probePath}`}`;
    try {
      await axios.get(url, {
        timeout: ConfigService.instance.MODEL_PROBE_TIMEOUT_MS ?? 5_000,
        validateStatus: (s) => s >= 200 && s < 500,
      });
      this.router.markProbeResult(id, true);
      return true;
    } catch (err) {
      this.router.markProbeResult(id, false, (err as Error).message);
      this.logger.warn({ detail: 'probe-fail', modelId: id, err: (err as Error).message });
      return false;
    }
  }
}
