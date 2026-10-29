/**
 * ShellUpgradeDeps — 升级编排的真实 docker 副作用（概设 §5 M11）
 *
 * 通过 `PLATFORM_UPGRADE_SCRIPT`（默认 scripts/tenant-upgrade.sh）执行：
 *   snapshot <tenantId> | swap <tenantId> <tag> | health <tenantId> | rollback <tenantId>
 * 台账与镜像 tag 由脚本写入 per-tenant 目录，便于回滚。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import axios from 'axios';
import type { UpgradeDeps } from './upgrade-orchestrator.js';

const execFileP = promisify(execFile);

export class ShellUpgradeDeps implements UpgradeDeps {
  constructor(
    private readonly script: string,
    private readonly timeoutMs = 120_000,
    private readonly observeMs = 0,
    private readonly opsWebhookUrl = '',
    private readonly contactLookup?: (tenantId: string) => Promise<string | null>,
    private readonly emailWebhookUrl = '',
    private readonly audit?: { append(entry: { action: 'tenant.alert'; actor: string; tenantId: string; payload: Record<string, unknown> }): Promise<unknown> },
  ) {}

  private async run(...args: string[]): Promise<void> {
    await execFileP(this.script, args, {
      timeout: this.timeoutMs,
      env: { ...process.env },
    });
  }

  async snapshot(tenantId: string): Promise<void> {
    await this.run('snapshot', tenantId);
  }

  async swapImage(tenantId: string, tag: string): Promise<void> {
    await this.run('swap', tenantId, tag);
  }

  async health(tenantId: string): Promise<boolean> {
    try {
      await this.run('health', tenantId);
      return true;
    } catch {
      return false;
    }
  }

  async rollback(tenantId: string): Promise<void> {
    await this.run('rollback', tenantId);
  }

  async notify(tenantIds: readonly string[], windowStart: Date): Promise<void> {
    for (const tenantId of tenantIds) {
      const contact = this.contactLookup ? await this.contactLookup(tenantId).catch(() => null) : null;
      const content = `[升级通知] 租户 ${tenantId} 计划于 ${windowStart.toISOString()} 升级，请提前安排。`;
      try {
        if (contact && this.emailWebhookUrl) {
          await axios.post(this.emailWebhookUrl, { to: contact, subject: '系统升级通知', body: content }, { timeout: 5000 });
        } else if (this.opsWebhookUrl) {
          await axios.post(this.opsWebhookUrl, { msgtype: 'text', text: { content: `${content}（无租户联系人，回退运维）` } }, { timeout: 5000 });
          await this.audit?.append({
            action: 'tenant.alert',
            actor: 'system:upgrade',
            tenantId,
            payload: { reason: 'upgrade_notice_fallback', windowStart: windowStart.toISOString() },
          });
        }
      } catch {
        /* 单个租户通知失败不影响升级编排 */
      }
    }
  }

  async observe(tenantId: string): Promise<boolean> {
    if (this.observeMs > 0) {
      await new Promise((r) => setTimeout(r, this.observeMs));
    }
    return this.health(tenantId);
  }
}
