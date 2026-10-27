/**
 * PlatformController 端点单测（升级 / 平台总览 / 导出 / 注销）
 */
import { describe, it, expect, jest } from '@jest/globals';
import { PlatformController } from '../src/platform/platform.controller.js';

function makeCtrl() {
  const tenants = {
    list: jest.fn(async () => ({
      rows: [{ id: 't1' }, { id: 't2' }],
      total: 2,
      limit: 50,
      offset: 0,
    })),
  };
  const upgrade = {
    run: jest.fn(async (ids: string[], _tag: string) => ({
      upgraded: ids,
      failed: [],
      rolledBack: [],
    })),
  };
  const monitor = {
    collect: jest.fn(async (ids: string[]) => ({
      overview: { tenantCount: ids.length },
      instances: [],
    })),
  };
  const offboarding = {
    export: jest.fn(async (id: string) => `data/tenants/${id}/export.enc`),
    destroy: jest.fn(async (_id: string, approvals: string[]) => ({
      deleted: true,
      approvals: approvals.length,
    })),
  };
  const ctrl = new PlatformController(
    tenants as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    upgrade as any,
    monitor as any,
    offboarding as any,
    {} as any,
  );
  return { ctrl, tenants, upgrade, monitor, offboarding };
}

describe('PlatformController 升级/监控/注销', () => {
  it('POST /platform/upgrades 使用全部租户（未指定 tenantIds）', async () => {
    const { ctrl, upgrade } = makeCtrl();
    const r = await ctrl.upgrades({ tag: 'v2' });
    expect(upgrade.run).toHaveBeenCalledWith(['t1', 't2'], 'v2');
    expect(r.upgraded).toEqual(['t1', 't2']);
  });

  it('POST /platform/upgrades 指定 tenantIds', async () => {
    const { ctrl, upgrade } = makeCtrl();
    await ctrl.upgrades({ tenantIds: ['x'], tag: 'v3' });
    expect(upgrade.run).toHaveBeenCalledWith(['x'], 'v3');
  });

  it('GET /platform/usage 聚合全部租户', async () => {
    const { ctrl, monitor } = makeCtrl();
    const r = await ctrl.platformUsage();
    expect(monitor.collect).toHaveBeenCalledWith(['t1', 't2']);
    expect((r as any).overview.tenantCount).toBe(2);
  });

  it('POST /platform/tenants/:id/export 返回包路径', async () => {
    const { ctrl, offboarding } = makeCtrl();
    const r = await ctrl.exportTenant('t1');
    expect(offboarding.export).toHaveBeenCalledWith('t1');
    expect(r).toEqual({ path: 'data/tenants/t1/export.enc' });
  });

  it('POST /platform/tenants/:id/destroy 透传双签', async () => {
    const { ctrl, offboarding } = makeCtrl();
    const r = await ctrl.destroyTenant('t1', { approvals: ['ops:a', 'ops:b'] });
    expect(offboarding.destroy).toHaveBeenCalledWith('t1', ['ops:a', 'ops:b']);
    expect(r.deleted).toBe(true);
  });
});
