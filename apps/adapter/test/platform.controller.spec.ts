/**
 * PlatformController 端点单测（生命周期 / 配额 / 审计 / TLS / 升级 / 注销）
 */
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import {
  PlatformController,
  PlatformEnabledGuard,
  PlatformReasonGuard,
} from '../src/platform/platform.controller.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import { ADMIN_USER_KEY } from '../src/admin/admin-roles.js';

type AnyFn = (...args: any[]) => any;

function makeCtrl() {
  const tenants = {
    create: jest.fn<AnyFn>(async () => ({ id: 't1' })),
    list: jest.fn<AnyFn>(async () => ({
      rows: [{ id: 't1' }, { id: 't2' }],
      total: 2,
      limit: 50,
      offset: 0,
    })),
    getDetail: jest.fn<AnyFn>(async (id: string) => ({ id })),
    recordShellAccess: jest.fn<AnyFn>(async () => ({ ok: true })),
    handoffCredentials: jest.fn<AnyFn>(async () => ({ password: 'once' })),
    restart: jest.fn<AnyFn>(async () => undefined),
    provision: jest.fn<AnyFn>(async () => ({ status: 'provisioning' })),
    collectFingerprint: jest.fn<AnyFn>(async () => ({ fingerprint: 'fp' })),
    reissueLicense: jest.fn<AnyFn>(async () => ({ ok: true })),
    renew: jest.fn<AnyFn>(async () => ({ expiresAt: '2099-01-01' })),
    suspend: jest.fn<AnyFn>(async () => ({ status: 'paused' })),
    resume: jest.fn<AnyFn>(async () => ({ status: 'active' })),
    terminate: jest.fn<AnyFn>(async () => ({ status: 'terminated' })),
  };
  const quota = {
    setQuota: jest.fn<AnyFn>(async () => ({ maxChats: 10 })),
    consume: jest.fn<AnyFn>(async () => ({ ok: true })),
  };
  const audit = {
    list: jest.fn<AnyFn>(async () => ({ rows: [], total: 0 })),
    verifyChain: jest.fn<AnyFn>(async () => ({ ok: true })),
  };
  const sweep = { sweep: jest.fn<AnyFn>(async () => ({ expired: 0 })) };
  const usageService = {
    queryUsage: jest.fn<AnyFn>(async () => ({ rows: [] })),
    upsertReport: jest.fn<AnyFn>(async () => undefined),
  };
  const upgrade = {
    run: jest.fn<AnyFn>(async (ids: string[], _tag: string) => ({
      upgraded: ids,
      failed: [],
      rolledBack: [],
    })),
  };
  const monitor = {
    collect: jest.fn<AnyFn>(async (ids: string[]) => ({
      overview: { tenantCount: ids.length },
      instances: [],
    })),
  };
  const offboarding = {
    export: jest.fn<AnyFn>(async (id: string) => ({
      path: `data/tenants/${id}/export.enc`,
      confirmToken: 'tok',
      expiresAt: '2026-10-29T00:00:00.000Z',
    })),
    destroy: jest.fn<AnyFn>(async (_id: string, approvals: string[], _token?: string) => ({
      status: 'offboarding',
      scheduledAt: '2026-11-04T00:00:00.000Z',
      approvals: approvals.length,
    })),
  };
  const secrets = { update: jest.fn<AnyFn>(async () => ['wecomToken']) };
  const wildcardTls = {
    status: jest.fn<AnyFn>(async () => ({ ok: true })),
    renew: jest.fn<AnyFn>(async () => ({ renewed: true })),
  };
  const ctrl = new PlatformController(
    tenants as any,
    quota as any,
    audit as any,
    sweep as any,
    usageService as any,
    upgrade as any,
    monitor as any,
    offboarding as any,
    secrets as any,
    wildcardTls as any,
  );
  return { ctrl, tenants, quota, audit, sweep, usageService, upgrade, monitor, offboarding, secrets, wildcardTls };
}

function reqWithUser(username = 'ops'): any {
  return { [ADMIN_USER_KEY]: { username } };
}

describe('PlatformEnabledGuard / PlatformReasonGuard', () => {
  afterEach(() => resetConfig());

  it('PLATFORM_ENABLED=false → 404 PLATFORM_DISABLED', () => {
    setConfig({ PLATFORM_ENABLED: false });
    const g = new PlatformEnabledGuard();
    expect(() => g.canActivate({} as any)).toThrow(NotFoundException);
  });

  it('PLATFORM_ENABLED=true → 放行', () => {
    setConfig({ PLATFORM_ENABLED: true });
    const g = new PlatformEnabledGuard();
    expect(g.canActivate({} as any)).toBe(true);
  });

  it('GET 请求跳过 reason', () => {
    const g = new PlatformReasonGuard();
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', path: '/platform/tenants', body: {}, headers: {} }),
      }),
    };
    expect(g.canActivate(ctx as any)).toBe(true);
  });

  it('POST 无 reason → PLATFORM_REASON_REQUIRED', () => {
    const g = new PlatformReasonGuard();
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/platform/tenants', body: {}, headers: {} }),
      }),
    };
    expect(() => g.canActivate(ctx as any)).toThrow(BadRequestException);
  });

  it('POST /platform/report 免 reason', () => {
    const g = new PlatformReasonGuard();
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', path: '/platform/report', body: {}, headers: {} }),
      }),
    };
    expect(g.canActivate(ctx as any)).toBe(true);
  });
});

describe('PlatformController 生命周期与配额', () => {
  it('create/list/detail/secrets/shell/handoff/restart/provision/fingerprint/reissue', async () => {
    const { ctrl, tenants, secrets } = makeCtrl();
    const req = reqWithUser('alice');
    await ctrl.create({ name: 'n1', contact: 'c', plan: 'pro' }, req);
    expect(tenants.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'n1', contact: 'c', plan: 'pro' }),
      'alice',
    );
    await ctrl.list('active', '10', '0');
    expect(tenants.list).toHaveBeenCalledWith('active', 10, 0);
    await ctrl.detail('t1');
    await ctrl.updateSecrets('t1', { wecomToken: 'x' });
    expect(secrets.update).toHaveBeenCalledWith('t1', { wecomToken: 'x' });
    await ctrl.recordShellAccess('t1', { durationMs: 5 }, req);
    await ctrl.handoffCredentials('t1', req);
    await ctrl.restartTenant('t1', req);
    await ctrl.provision('t1', req);
    await ctrl.collectFingerprint('t1', req);
    await ctrl.reissueLicense('t1', req);
  });

  it('renew/suspend/resume/terminate + quota set/consume + usage', async () => {
    const { ctrl, tenants, quota, usageService } = makeCtrl();
    const req = reqWithUser();
    await ctrl.renew('t1', { days: 30 }, req);
    expect(tenants.renew).toHaveBeenCalledWith('t1', 30, 'ops');
    await ctrl.suspend('t1', req);
    await ctrl.resume('t1', req);
    await ctrl.terminate('t1', req);
    await ctrl.setQuota('t1', { maxChats: 3, maxMsgsPerDay: 9 }, req);
    expect(quota.setQuota).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ maxChats: 3, maxApiCalls: 9 }),
      'ops',
    );
    await ctrl.consume('t1', { kind: 'api_calls', delta: 2 });
    expect(quota.consume).toHaveBeenCalledWith({ tenantId: 't1', kind: 'api_calls', delta: 2 });
    await ctrl.usage('t1', '2026-01-01', '2026-01-31');
    expect(usageService.queryUsage).toHaveBeenCalledWith('t1', '2026-01-01', '2026-01-31');
  });

  it('audit/sweep/tls/report', async () => {
    const { ctrl, audit, sweep, wildcardTls, usageService } = makeCtrl();
    await ctrl.auditLog('t1', 'create', 'a', 'b', '20', '1');
    expect(audit.list).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', action: 'create', limit: 20, offset: 1 }),
    );
    await ctrl.auditVerify();
    await ctrl.triggerSweep();
    expect(sweep.sweep).toHaveBeenCalled();
    await ctrl.wildcardTlsStatus();
    await ctrl.wildcardTlsRenew();
    expect(wildcardTls.renew).toHaveBeenCalled();
    const bad = await ctrl.report({});
    expect(bad).toEqual({ ok: false, error: 'tenantId required' });
    const ok = await ctrl.report({ tenantId: 't1', msgsIn: 1, date: '2026-01-02' });
    expect(ok).toEqual({ ok: true });
    expect(usageService.upsertReport).toHaveBeenCalledWith(
      't1',
      '2026-01-02',
      expect.objectContaining({ msgsIn: 1 }),
    );
  });
});

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

  it('POST /platform/tenants/:id/export 返回包路径与一次性令牌', async () => {
    const { ctrl, offboarding } = makeCtrl();
    const r = await ctrl.exportTenant('t1');
    expect(offboarding.export).toHaveBeenCalledWith('t1');
    expect(r).toEqual({
      path: 'data/tenants/t1/export.enc',
      confirmToken: 'tok',
      expiresAt: '2026-10-29T00:00:00.000Z',
    });
  });

  it('POST /platform/tenants/:id/destroy 透传双签与令牌', async () => {
    const { ctrl, offboarding } = makeCtrl();
    const r = await ctrl.destroyTenant('t1', { approvals: ['ops:a', 'ops:b'], confirmToken: 'tok' });
    expect(offboarding.destroy).toHaveBeenCalledWith('t1', ['ops:a', 'ops:b'], 'tok');
    expect(r.status).toBe('offboarding');
  });
});
