/**
 * M11 控制面可单测核心：密钥库 / 证书 / 升级 / 监控 / 提醒 / 注销 / 状态机 trialing
 */
import { describe, it, expect, jest } from '@jest/globals';
import { TenantSecretStore } from '../src/platform/tenant-secret-store.js';
import { ExportPackager } from '../src/platform/export-package.js';
import { FakeCertificateProvider } from '../src/platform/certificate-provider.js';
import { UpgradeOrchestrator, type UpgradeDeps } from '../src/platform/upgrade-orchestrator.js';
import { PlatformMonitor, type HealthSource } from '../src/platform/platform-monitor.js';
import { SubscriptionReminder, type Notifier } from '../src/platform/subscription-reminder.js';
import { TenantOffboarding, OffboardingBlockedException } from '../src/platform/tenant-offboarding.js';
import { TenantStateMachine, IllegalTenantTransition } from '../src/platform/tenant.state-machine.js';

describe('TenantSecretStore', () => {
  it('加密→解密 roundtrip', () => {
    const s = new TenantSecretStore('master-key-12345');
    const ct = s.encrypt('WECHAT_SECRET=abc');
    expect(ct).not.toContain('abc');
    expect(s.decrypt(ct)).toBe('WECHAT_SECRET=abc');
  });

  it('错误主密钥解密失败', () => {
    const a = new TenantSecretStore('master-key-aaaa');
    const b = new TenantSecretStore('master-key-bbbb');
    const ct = a.encrypt('secret');
    expect(() => b.decrypt(ct)).toThrow();
  });
});

describe('FakeCertificateProvider', () => {
  it('签发返回假证书', async () => {
    const c = new FakeCertificateProvider();
    const r = await c.issue('t1.example.com');
    expect(r.cert).toContain('t1.example.com');
    expect(c.issued).toContain('t1.example.com');
  });

  it('指定域名失败', async () => {
    const c = new FakeCertificateProvider(new Set(['bad.example.com']));
    await expect(c.issue('bad.example.com')).rejects.toThrow();
  });
});

function upgradeDeps(over: Partial<UpgradeDeps> = {}): UpgradeDeps & {
  snapshot: jest.Mock; swapImage: jest.Mock; health: jest.Mock; rollback: jest.Mock; observe: jest.Mock;
} {
  return {
    snapshot: jest.fn(async () => undefined),
    swapImage: jest.fn(async () => undefined),
    health: jest.fn(async () => true),
    rollback: jest.fn(async () => undefined),
    observe: jest.fn(async () => true),
    ...over,
  } as any;
}

describe('UpgradeOrchestrator', () => {
  it('金丝雀先行，观察通过后升级其余', async () => {
    const deps = upgradeDeps();
    const orch = new UpgradeOrchestrator(deps, 'canary', 50);
    const r = await orch.run(['canary', 't2', 't3'], 'v2');
    expect(deps.snapshot.mock.calls[0][0]).toBe('canary');
    expect(deps.observe).toHaveBeenCalledWith('canary');
    expect(r.upgraded).toEqual(expect.arrayContaining(['canary', 't2', 't3']));
    expect(r.failed).toEqual([]);
  });

  it('金丝雀健康检查失败 → 回滚并停止', async () => {
    const deps = upgradeDeps({ health: jest.fn(async () => false) as any });
    const orch = new UpgradeOrchestrator(deps, 'canary', 50);
    const r = await orch.run(['canary', 't2'], 'v2');
    expect(r.rolledBack).toContain('canary');
    expect(r.upgraded).not.toContain('canary');
    // t2 未被升级（金丝雀失败即停止）
    expect(deps.snapshot).toHaveBeenCalledTimes(1);
  });

  it('非金丝雀实例失败仅回滚该实例', async () => {
    let first = true;
    const deps = upgradeDeps({
      health: jest.fn(async () => {
        // 第一个（金丝雀）成功，第二个失败
        if (first) {
          first = false;
          return true;
        }
        return false;
      }) as any,
    });
    const orch = new UpgradeOrchestrator(deps, 'canary', 50);
    const r = await orch.run(['canary', 't2', 't3'], 'v2');
    expect(r.upgraded).toContain('canary');
    expect(r.rolledBack.length).toBeGreaterThanOrEqual(1);
  });
});

describe('PlatformMonitor', () => {
  it('聚合概览并列出异常实例', async () => {
    const source: HealthSource = {
      probe: async (id) => ({
        tenantId: id,
        healthy: id !== 't2',
        qaFailRate: id === 't2' ? 0.2 : 0,
        llmFailRate: 0,
      }),
    };
    const m = new PlatformMonitor(source);
    const { overview } = await m.collect(['t1', 't2', 't3']);
    expect(overview.tenantCount).toBe(3);
    expect(overview.healthy).toBe(2);
    expect(overview.unhealthy).toEqual(['t2']);
  });

  it('对异常实例执行重启', async () => {
    const restart = jest.fn(async (_id: string) => undefined);
    const m = new PlatformMonitor(
      { probe: async (id) => ({ tenantId: id, healthy: false, qaFailRate: 0, llmFailRate: 0 }) },
      restart,
    );
    const restarted = await m.remediate(['t2']);
    expect(restarted).toEqual(['t2']);
    expect(restart).toHaveBeenCalledWith('t2');
  });
});

describe('SubscriptionReminder', () => {
  const notifier: Notifier = { send: jest.fn(async () => undefined) };
  const now = new Date('2026-01-01T00:00:00Z');
  const mk = (id: string, days: number) => ({
    id,
    name: id,
    expiresAt: new Date(now.getTime() + days * 86_400_000),
  });

  it('T-30/15/7 命中', () => {
    const r = new SubscriptionReminder(notifier);
    const due = r.dueReminders([mk('a', 30), mk('b', 15), mk('c', 7), mk('d', 20)], now);
    expect(due.map((x) => x.tenantId)).toEqual(['a', 'b', 'c']);
  });

  it('dispatch 每租户发 2 条（租户 + 运营）', async () => {
    const n: Notifier = { send: jest.fn(async () => undefined) };
    const r = new SubscriptionReminder(n);
    const count = await r.dispatch([mk('a', 30)], now);
    expect(count).toBe(1);
    expect((n.send as jest.Mock).mock.calls.length).toBe(2);
  });
});

describe('TenantOffboarding', () => {
  const deps = {
    exportPackage: jest.fn(async () => '/tmp/pkg.tar.enc'),
    deleteTenant: jest.fn(async (_id: string) => undefined),
  };

  it('导出返回包路径', async () => {
    const o = new TenantOffboarding(deps);
    expect(await o.export('t1')).toBe('/tmp/pkg.tar.enc');
  });

  it('少于 2 签拒绝删除', async () => {
    const o = new TenantOffboarding(deps);
    await expect(o.destroy('t1', ['ops:alice'])).rejects.toBeInstanceOf(
      OffboardingBlockedException,
    );
    expect(deps.deleteTenant).not.toHaveBeenCalled();
  });

  it('双签后执行删除', async () => {
    const d = { exportPackage: jest.fn(async () => 'x'), deleteTenant: jest.fn(async (_id: string) => undefined) };
    const o = new TenantOffboarding(d);
    const r = await o.destroy('t1', ['ops:alice', 'ops:bob']);
    expect(r.deleted).toBe(true);
    expect(d.deleteTenant).toHaveBeenCalledWith('t1');
  });
});

describe('TenantStateMachine trialing', () => {
  it('trialing → active 合法', () => {
    expect(() => TenantStateMachine.assertTransition('trialing', 'active')).not.toThrow();
  });

  it('trialing → grace 非法', () => {
    expect(() => TenantStateMachine.assertTransition('trialing', 'grace')).toThrow(
      IllegalTenantTransition,
    );
  });
});

describe('ExportPackager', () => {
  it('build → read roundtrip（加密不含明文）', () => {
    const p = new ExportPackager(new TenantSecretStore('master-key-12345'));
    const enc = p.build({
      tenantId: 't1',
      knowledgeBase: 'KB-CONTENT',
      assets: ['a.png'],
      config: 'CFG-CONTENT',
    });
    expect(enc.toString('utf8')).not.toContain('KB-CONTENT');
    const back = p.read(enc);
    expect(back.tenantId).toBe('t1');
    expect(back.knowledgeBase).toBe('KB-CONTENT');
    expect(back.assets).toEqual(['a.png']);
  });
});
