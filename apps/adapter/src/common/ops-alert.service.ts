/**
 * OpsAlertService — 统一运维事件告警（概设 §12 风险 4 等）
 *
 * - 按 key 冷却：同一类事件在冷却期内最多推送一次，避免配置错误造成告警风暴
 * - 通道复用 OPS_WEBHOOK_URL（企微群机器人 text）；未配置 = 关闭
 * - 告警是旁路：发送失败只 WARN，绝不影响调用方（如企微 401 响应）
 */
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from './logger.js';

export interface OpsAlertOptions {
  cooldownMs?: number;
  now?: () => number;
  send?: (content: string) => Promise<boolean>;
}

export class OpsAlertService {
  private readonly logger = new AppLogger('OpsAlert');
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly send?: (content: string) => Promise<boolean>;
  private readonly lastSent = new Map<string, number>();

  constructor(opts: OpsAlertOptions = {}) {
    // 构造可能先于 ConfigService 初始化（单测/早期启动），安全降级到默认值
    let configured: number | undefined;
    try {
      configured = ConfigService.instance?.OPS_ALERT_COOLDOWN_MS;
    } catch {
      configured = undefined;
    }
    this.cooldownMs = opts.cooldownMs ?? configured ?? 1_800_000;
    this.now = opts.now ?? (() => Date.now());
    this.send = opts.send;
  }

  /** 按 key 冷却推送；返回是否真正发出 */
  async alert(key: string, content: string): Promise<boolean> {
    const t = this.now();
    const last = this.lastSent.get(key) ?? 0;
    if (t - last < this.cooldownMs) return false;
    this.lastSent.set(key, t);

    try {
      if (this.send) return await this.send(content);
      const url = ConfigService.instance?.OPS_WEBHOOK_URL;
      if (!url) return false;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: `[cs-bot] ${content}` } }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) this.logger.warn({ detail: 'ops-alert-non-ok', key, status: res.status });
      return res.ok;
    } catch (err) {
      this.logger.warn({ detail: 'ops-alert-failed', key, err: (err as Error).message });
      return false;
    }
  }

  /** 测试/诊断：该 key 的冷却状态 */
  isCooling(key: string): boolean {
    return this.now() - (this.lastSent.get(key) ?? 0) < this.cooldownMs;
  }
}
