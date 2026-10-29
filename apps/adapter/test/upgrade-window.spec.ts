import { describe, it, expect, jest } from '@jest/globals';
import { UpgradeOrchestrator, type UpgradeDeps } from '../src/platform/upgrade-orchestrator.js';
import { ShellUpgradeDeps } from '../src/platform/upgrade-runner.js';

const axiosPost = jest.fn(async () => ({ status: 200 })) as any;
jest.mock('axios', () => ({ __esModule: true, default: { post: (...a: unknown[]) => axiosPost(...a) } }));

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

  it('defers at least three business days (skipping weekends)', async () => {
    const d = deps();
    // 2026-10-30 是周五：3 个自然日只到周一，3 个工作日应到周三 11-04
    const now = new Date('2026-10-30T12:00:00');
    const up = new UpgradeOrchestrator(d, undefined, 10, { window: '02:00-04:00', now: () => now });
    const res = await up.run(['t1'], 'v2');
    expect(res.deferred).toBe(true);
    expect(new Date(res.windowStart!).toDateString()).toBe(new Date('2026-11-04T02:00:00').toDateString());
  });

  it('notifies tenant contact directly when available', async () => {
    axiosPost.mockClear();
    const deps = new ShellUpgradeDeps('noop', 5000, 0, 'https://ops/hook', async () => 'tenant@example.com', 'https://email/hook');
    await deps.notify(['t1'], new Date('2026-11-01T02:00:00Z'));
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost.mock.calls[0][0]).toBe('https://email/hook');
    expect((axiosPost.mock.calls[0][1] as any).to).toBe('tenant@example.com');
  });

  it('falls back to ops and audits when contact is missing', async () => {
    axiosPost.mockClear();
    const audit: any = jest.fn(async () => 'h');
    const deps = new ShellUpgradeDeps('noop', 5000, 0, 'https://ops/hook', async () => null, 'https://email/hook', { append: audit });
    await deps.notify(['t1'], new Date('2026-11-01T02:00:00Z'));
    expect(axiosPost.mock.calls[0][0]).toBe('https://ops/hook');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.alert', tenantId: 't1' }));
  });
});
