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
  /** 升级通知（可选；生产可发 webhook/邮件） */
  notify?(tenantIds: readonly string[], windowStart: Date): Promise<void>;
}

export interface UpgradeResult {
  upgraded: string[];
  failed: string[];
  rolledBack: string[];
  deferred?: boolean;
  windowStart?: string;
}

export class UpgradeOrchestrator {
  constructor(
    private readonly deps: UpgradeDeps,
    private readonly canaryId?: string,
    private readonly batchPct = 10,
    private readonly opts: {
      window?: string;
      noticeDays?: number;
      now?: () => Date;
    } = {},
  ) {}

  async run(tenantIds: readonly string[], tag: string, force = false): Promise<UpgradeResult> {
    const now = this.opts.now ? this.opts.now() : new Date();
    const window = parseWindow(this.opts.window ?? '02:00-04:00', now);
    if (!force && !(this.opts.noticeDays === 0 && inWindow(now, window))) {
      const noticeMs = (this.opts.noticeDays ?? 3) * 86_400_000;
      let scheduled = nextWindow(now, window);
      if (scheduled.getTime() <= now.getTime()) {
        scheduled = new Date(scheduled.getTime() + 86_400_000);
      }
      // 提前通知：窗口不得早于 now + noticeDays；不足则按整天顺延
      while (scheduled.getTime() - now.getTime() < noticeMs) {
        scheduled = new Date(scheduled.getTime() + 86_400_000);
      }
      if (this.deps.notify) await this.deps.notify(tenantIds, scheduled);
      return { upgraded: [], failed: [], rolledBack: [], deferred: true, windowStart: scheduled.toISOString() };
    }
    if (this.deps.notify) await this.deps.notify(tenantIds, now);
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


interface WindowTimes { start: number; end: number }

function parseWindow(spec: string, day: Date): WindowTimes {
  const [a, b] = spec.split('-');
  const parse = (v: string) => {
    const [h, m] = v.split(':').map(Number);
    const d = new Date(day);
    d.setHours(h, m ?? 0, 0, 0);
    return d.getTime();
  };
  return { start: parse(a), end: parse(b) };
}

function inWindow(now: Date, w: WindowTimes): boolean {
  const t = now.getTime();
  return t >= w.start && t < w.end;
}

function nextWindow(now: Date, w: WindowTimes): Date {
  const d = new Date(w.start);
  if (now.getTime() >= w.end) d.setDate(d.getDate() + 1);
  return d;
}
