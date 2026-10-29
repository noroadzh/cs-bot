/**
 * LLM 双通道失败告警（概设 §11.2 降级矩阵）
 *
 * - 滑动窗口内失败次数达阈值 → 推送一次运维 webhook（OPS_WEBHOOK_URL）
 * - 冷却期内不重复推送
 * - 成功一次即清零窗口并结束本轮的“已告警”状态
 * - 告警是旁路：URL 未配置 / 发送失败只 WARN，绝不影响问答链路
 */
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export interface LlmAlertOptions {
  threshold?: number;
  windowMs?: number;
  cooldownMs?: number;
  now?: () => number;
  send?: (content: string) => Promise<boolean>;
}

export class LlmAlertService {
  private readonly logger = new AppLogger('LlmAlert');
  private failures: number[] = [];
  private lastAlertAt = 0;
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly send?: (content: string) => Promise<boolean>;

  constructor(opts: LlmAlertOptions = {}) {
    const cfg = ConfigService.instance;
    this.threshold = opts.threshold ?? cfg?.LLM_ALERT_THRESHOLD ?? 3;
    this.windowMs = opts.windowMs ?? cfg?.LLM_ALERT_WINDOW_MS ?? 300_000;
    this.cooldownMs = opts.cooldownMs ?? cfg?.LLM_ALERT_COOLDOWN_MS ?? 1_800_000;
    this.now = opts.now ?? (() => Date.now());
    this.send = opts.send;
  }

  /** 记录一次双通道失败；达阈值且不在冷却期时推送告警 */
  async recordFailure(reason = 'dual-channel-failure'): Promise<boolean> {
    const t = this.now();
    this.failures = this.failures.filter((x) => t - x <= this.windowMs);
    this.failures.push(t);

    if (this.failures.length < this.threshold) return false;
    if (t - this.lastAlertAt < this.cooldownMs) return false;
    this.lastAlertAt = t;

    const content = `[cs-bot] LLM 双通道连续失败 ${this.failures.length} 次（last: ${reason}）`;
    try {
      if (this.send) {
        const ok = await this.send(content);
        if (!ok) this.logger.warn({ detail: 'llm-alert-send-failed' });
        return ok;
      }
      await this.sendWebhook(content);
      return true;
    } catch (err) {
      this.logger.warn({ detail: 'llm-alert-failed', err: (err as Error).message });
      return false;
    }
  }

  /** 一次成功即清零窗口 */
  recordSuccess(): void {
    this.failures = [];
    this.lastAlertAt = 0;
  }

  /** 当前窗口内失败次数（测试/诊断用） */
  get failureCount(): number {
    const t = this.now();
    return this.failures.filter((x) => t - x <= this.windowMs).length;
  }

  private async sendWebhook(content: string): Promise<void> {
    const url = ConfigService.instance?.OPS_WEBHOOK_URL;
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content } }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.logger.warn({ detail: 'llm-alert-non-ok', status: res.status });
    } catch (err) {
      this.logger.warn({ detail: 'llm-alert-webhook-failed', err: (err as Error).message });
    }
  }
}

/** Nest provider 工厂（无状态依赖时直接 new） */
export function createLlmAlert(opts?: LlmAlertOptions): LlmAlertService {
  return new LlmAlertService(opts);
}
