/**
 * UpgradeOrchestrator — 批量升级 / 灰度 / 回滚（概设 §5 M11 升级编排）
 *
 * 外部副作用经 UpgradeDeps 注入（快照/换镜像/健康/回滚/观察），便于单测。
 * 行为：金丝雀先行 → 观察通过 → 按批次（≤10%）升级；任一步失败自动回滚。
 */

export interface UpgradeDeps {
  snapshot(tenantId: string): Promise<void>;
  swapImage(tenantId: string, tag: string): Promise<void>;
  health(tenantId: string): Promise<boolean>;
  rollback(tenantId: string): Promise<void>;
  /** 金丝雀观察（生产可 sleep 24h；测试返回是否通过） */
  observe(tenantId: string): Promise<boolean>;
}

export interface UpgradeResult {
  upgraded: string[];
  failed: string[];
  rolledBack: string[];
}

export class UpgradeOrchestrator {
  constructor(
    private readonly deps: UpgradeDeps,
    private readonly canaryId?: string,
    private readonly batchPct = 10,
  ) {}

  async run(tenantIds: readonly string[], tag: string): Promise<UpgradeResult> {
    const upgraded: string[] = [];
    const failed: string[] = [];
    const rolledBack: string[] = [];

    const ids = [...tenantIds];
    // 金丝雀先行
    if (this.canaryId && ids.includes(this.canaryId)) {
      const ok = await this.upgradeOne(this.canaryId, tag, failed, rolledBack);
      if (!ok) return { upgraded, failed, rolledBack };
      const observed = await this.deps.observe(this.canaryId);
      if (!observed) {
        await this.deps.rollback(this.canaryId);
        rolledBack.push(this.canaryId);
        failed.push(this.canaryId);
        return { upgraded, failed, rolledBack };
      }
      upgraded.push(this.canaryId);
    }

    // 剩余按批次
    const rest = ids.filter((id) => id !== this.canaryId);
    const batchSize = Math.max(1, Math.ceil(rest.length * (this.batchPct / 100)));
    for (let i = 0; i < rest.length; i += batchSize) {
      const batch = rest.slice(i, i + batchSize);
      for (const id of batch) {
        const ok = await this.upgradeOne(id, tag, failed, rolledBack);
        if (ok) upgraded.push(id);
      }
    }

    return { upgraded, failed, rolledBack };
  }

  /** @returns 是否成功 */
  private async upgradeOne(
    id: string,
    tag: string,
    failed: string[],
    rolledBack: string[],
  ): Promise<boolean> {
    try {
      await this.deps.snapshot(id);
      await this.deps.swapImage(id, tag);
      const healthy = await this.deps.health(id);
      if (!healthy) {
        await this.deps.rollback(id);
        rolledBack.push(id);
        failed.push(id);
        return false;
      }
      return true;
    } catch {
      await this.deps.rollback(id).catch(() => undefined);
      rolledBack.push(id);
      failed.push(id);
      return false;
    }
  }
}
