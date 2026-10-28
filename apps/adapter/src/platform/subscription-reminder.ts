/**
 * SubscriptionReminder — 订阅到期提醒（概设 §5 M11 订阅管控）
 *
 * T-30/15/7 天提醒租户与运维；通知通道经 Notifier 注入（邮件/群 webhook 可替换）。
 */
import axios from 'axios';

export interface Notifier {
  send(target: string, subject: string, body: string): Promise<void>;
}

/** 生产：运维群 webhook；url 为空时仅记日志（开发/测试） */
export class WebhookNotifier implements Notifier {
  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    if (!this.url) return;
    try {
      await axios.post(
        this.url,
        { msgtype: 'text', text: { content: `[${target}] ${subject}\n${body}` } },
        { timeout: this.timeoutMs },
      );
    } catch {
      /* 提醒失败不影响主流程 */
    }
  }
}

export class EmailWebhookNotifier implements Notifier {
  constructor(private readonly url: string, private readonly timeoutMs = 5000) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    if (!this.url) return;
    try {
      await axios.post(
        this.url,
        { to: target, subject, body },
        { timeout: this.timeoutMs },
      );
    } catch {
      /* 邮件网关失败不影响主流程 */
    }
  }
}

export class MultiNotifier implements Notifier {
  constructor(private readonly notifiers: readonly Notifier[]) {}

  async send(target: string, subject: string, body: string): Promise<void> {
    await Promise.all(this.notifiers.map((n) => n.send(target, subject, body)));
  }
}

export interface ReminderTenant {
  id: string;
  name: string;
  expiresAt: Date;
}

export interface DueReminder {
  tenantId: string;
  tenantName: string;
  daysLeft: number;
  stage: 30 | 15 | 7;
}

const STAGES: readonly (30 | 15 | 7)[] = [30, 15, 7];

export class SubscriptionReminder {
  constructor(private readonly notifier: Notifier) {}

  dueReminders(tenants: readonly ReminderTenant[], now: Date): DueReminder[] {
    const out: DueReminder[] = [];
    for (const t of tenants) {
      const daysLeft = Math.ceil((t.expiresAt.getTime() - now.getTime()) / 86_400_000);
      const stage = STAGES.find((s) => daysLeft === s);
      if (stage !== undefined) {
        out.push({ tenantId: t.id, tenantName: t.name, daysLeft, stage });
      }
    }
    return out;
  }

  /** 发送到期提醒，返回发送的提醒条数 */
  async dispatch(
    tenants: readonly ReminderTenant[],
    now: Date,
    tenantTarget = 'tenant',
    opsTarget = 'ops',
  ): Promise<number> {
    const due = this.dueReminders(tenants, now);
    for (const r of due) {
      await this.notifier.send(
        tenantTarget,
        `订阅即将到期（剩余 ${r.daysLeft} 天）`,
        `租户 ${r.tenantName} 将在 ${r.daysLeft} 天后到期，请及时续费。`,
      );
      await this.notifier.send(
        opsTarget,
        `[运营] 租户到期提醒 T-${r.stage}`,
        `${r.tenantName} 剩余 ${r.daysLeft} 天`,
      );
    }
    return due.length;
  }
}
