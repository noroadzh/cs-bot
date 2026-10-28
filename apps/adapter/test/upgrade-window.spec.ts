import { describe, it, expect, jest } from '@jest/globals';
import { UpgradeOrchestrator, type UpgradeDeps } from '../src/platform/upgrade-orchestrator.js';

const deps = (): UpgradeDeps => ({
  snapshot: jest.fn(async () => undefined),
  swapImage: jest.fn(async () => undefined),
  health: jest.fn(async () => true),
  rollback: jest.fn(async () => undefined),
  observe: jest.fn(async () => true),
  notify: jest.fn(async () => undefined),
});

describe('UpgradeOrchestrator window', () => {
  it('defers outside the 02:00-04:00 window and notifies', async () => {
    const d = deps();
    const now = new Date('2026-10-28T12:00:00');
    const up = new UpgradeOrchestrator(d, undefined, 10, { window: '02:00-04:00', now: () => now });
    const res = await up.run(['t1'], 'v2');
    expect(res.deferred).toBe(true);
    expect(d.swapImage).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalled();
    expect(new Date(res.windowStart!).getTime() - now.getTime()).toBeGreaterThanOrEqual(3 * 86_400_000);
  });

  it('runs with force outside the window', async () => {
    const d = deps();
    const now = new Date('2026-10-28T12:00:00');
    const up = new UpgradeOrchestrator(d, undefined, 10, { window: '02:00-04:00', now: () => now });
    const res = await up.run(['t1'], 'v2', true);
    expect(res.upgraded).toContain('t1');
    expect(d.swapImage).toHaveBeenCalled();
  });

  it('runs inside the window', async () => {
    const d = deps();
    const now = new Date('2026-10-28T03:00:00');
    const up = new UpgradeOrchestrator(d, undefined, 10, { window: '02:00-04:00', now: () => now, noticeDays: 0 });
    const res = await up.run(['t1'], 'v2');
    expect(res.upgraded).toContain('t1');
  });
});
