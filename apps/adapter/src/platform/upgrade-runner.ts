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
    if (!this.opsWebhookUrl) return;
    const content = `[升级通知] ${tenantIds.length} 个租户计划于 ${windowStart.toISOString()} 升级，请提前 3 个工作日通知租户。`;
    try {
      await axios.post(this.opsWebhookUrl, { msgtype: 'text', text: { content } }, { timeout: 5000 });
    } catch {
      /* 通知失败不阻断升级编排 */
    }
  }

  async observe(tenantId: string): Promise<boolean> {
    if (this.observeMs > 0) {
      await new Promise((r) => setTimeout(r, this.observeMs));
    }
    return this.health(tenantId);
  }
}
