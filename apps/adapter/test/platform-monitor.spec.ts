import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { PlatformMonitor, type HealthSource } from '../src/platform/platform-monitor.js';

const source = (healthy: boolean[]): HealthSource & { calls: number } => {
  let i = 0;
  return {
    calls: 0,
    async probe(id: string) {
      this.calls += 1;
      const ok = healthy[Math.min(i, healthy.length - 1)];
      i += 1;
      return { tenantId: id, healthy: ok, qaFailRate: 0, llmFailRate: 0 };
    },
  } as any;
};

describe('PlatformMonitor', () => {
  let now: number;
  let restarts: string[];
  let audit: Array<{ action: string; tenantId: string | null; payload: any }>;

  beforeEach(() => {
    now = 10_000_000;
    restarts = [];
    audit = [];
  });

  const make = (health: HealthSource, restart?: (id: string) => Promise<void>, opts: any = {}) =>
    new PlatformMonitor(health, restart, { append: async (e) => { audit.push(e); } }, {
      listTenants: async () => ['t1'],
      intervalMs: 0,
      now: () => now,
      ...opts,
    });

  it('does not restart on a single failed probe', async () => {
    const monitor = make(source([false]), async (id) => { restarts.push(id); });
    await monitor.tick();
    expect(restarts).toEqual([]);
  });

  it('restarts after consecutive failures and resets the counter', async () => {
    const monitor = make(source([false]), async (id) => { restarts.push(id); });
    await monitor.tick();
    await monitor.tick();
    expect(restarts).toEqual(['t1']);
    expect(audit.some((a) => a.action === 'tenant.restart')).toBe(true);
    await monitor.tick();
    expect(restarts).toEqual(['t1']);
  });

  it('resets the failure counter when the instance recovers', async () => {
    const monitor = make(source([false, true]), async (id) => { restarts.push(id); });
    await monitor.tick();
    await monitor.tick();
    await monitor.tick();
    expect(restarts).toEqual([]);
  });

  it('stops restarting after the hourly limit and alerts', async () => {
    const monitor = make(source([false]), async (id) => { restarts.push(id); }, {
      maxRestartsPerHour: 1,
    });
    for (let i = 0; i < 4; i += 1) await monitor.tick();
    expect(restarts).toEqual(['t1']);
    expect(audit.some((a) => a.action === 'tenant.alert' && a.payload.reason === 'restart_limit_reached')).toBe(true);
  });

  it('alerts once per window for repeated failures', async () => {
    const monitor = make(source([false]), undefined);
    await monitor.tick();
    await monitor.tick();
    await monitor.tick();
    const alerts = audit.filter((a) => a.action === 'tenant.alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload.reason).toBe('unhealthy_no_restart_handler');
  });

  it('keeps sweeping when a restart throws', async () => {
    const monitor = make(source([false]), async () => { throw new Error('docker down'); });
    await monitor.tick();
    await monitor.tick();
    expect(audit.some((a) => a.action === 'tenant.alert' && a.payload.reason === 'restart_failed')).toBe(true);
  });

  it('alerts once after consecutive high resource probes without restarting', async () => {
    const health: any = {
      calls: 0,
      async probe(id: string) {
        this.calls += 1;
        return { tenantId: id, healthy: true, qaFailRate: 0, llmFailRate: 0, cpuPct: 95, memPct: 40 };
      },
    };
    const m = make(health, async (id) => { restarts.push(id); }, {
      resourceAlertPct: 90,
      resourceAlertStreak: 3,
    });

    await m.tick();
    await m.tick();
    expect(audit.some((a) => a.payload?.reason === 'resource_high')).toBe(false);

    await m.tick();
    const alerts = audit.filter((a) => a.payload?.reason === 'resource_high');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].payload).toMatchObject({ cpuPct: 95, memPct: 40, thresholdPct: 90 });
    expect(restarts).toEqual([]);
  });

  it('does not alert on a single high spike', async () => {
    let n = 0;
    const health: any = {
      async probe(id: string) {
        n += 1;
        return { tenantId: id, healthy: true, qaFailRate: 0, llmFailRate: 0, cpuPct: n === 1 ? 99 : 10, memPct: 10 };
      },
    };
    const m = make(health, undefined, { resourceAlertPct: 90, resourceAlertStreak: 2 });
    await m.tick();
    await m.tick();
    expect(audit.some((a) => a.payload?.reason === 'resource_high')).toBe(false);
  });

  it('does not run when no tenant list is configured', async () => {
    const health = source([false]);
    const monitor = new PlatformMonitor(health, async () => { restarts.push('x'); });
    await monitor.tick();
    expect(health.calls).toBe(0);
  });

  it('runs on the configured interval', async () => {
    jest.useFakeTimers();
    const list = jest.fn(async () => [] as string[]);
    const monitor = new PlatformMonitor(
      { probe: async (id: string) => ({ tenantId: id, healthy: true, qaFailRate: 0, llmFailRate: 0 }) },
      undefined,
      undefined,
      { listTenants: list, intervalMs: 1000 },
    );
    try {
      monitor.onModuleInit();
      jest.advanceTimersByTime(1000);
      await Promise.resolve();
      await Promise.resolve();
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      await monitor.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('does not re-enter while a sweep is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let probes = 0;
    const monitor = new PlatformMonitor(
      {
        probe: async (id: string) => {
          probes += 1;
          await gate;
          return { tenantId: id, healthy: true, qaFailRate: 0, llmFailRate: 0 };
        },
      },
      undefined,
      undefined,
      { listTenants: async () => ['t1'], intervalMs: 0 },
    );
    const first = monitor.tick();
    const second = monitor.tick();
    release();
    await Promise.all([first, second]);
    expect(probes).toBe(1);
  });
});
