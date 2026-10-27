/**
 * 配额 80% 预警通知（租户 + 运营）
 */
import axios from 'axios';

export interface QuotaWarningNotifier {
  warn(tenantId: string, kind: string, used: number, limit: number): Promise<void>;
}

/** 纯函数：是否达到 80% 预警线（不含 100% 超限，超限由 429 处理） */
export function isQuotaWarning(used: number, limit: number): boolean {
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return used >= limit * 0.8 && used <= limit;
}

export class WebhookQuotaWarningNotifier implements QuotaWarningNotifier {
  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async warn(tenantId: string, kind: string, used: number, limit: number): Promise<void> {
    if (!this.url) return;
    const content = `[配额预警] 租户 ${tenantId} 维度 ${kind} 已用 ${used}/${limit}（≥80%）`;
    try {
      await axios.post(this.url, { msgtype: 'text', text: { content } }, { timeout: this.timeoutMs });
    } catch {
      /* 告警失败不影响主流程 */
    }
  }
}
