import { describe, it, expect, beforeEach } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import {
  TenantOffboarding,
  type OffboardingRecord,
  type OffboardingRepo,
} from '../src/platform/tenant-offboarding.js';
import type { TenantStatus } from '../src/platform/tenant.entity.js';

class FakeRepo implements OffboardingRepo {
  tenants = new Map<string, TenantStatus>();
  records = new Map<string, OffboardingRecord>();

  async getTenantStatus(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async get(id: string) {
    return this.records.get(id) ?? null;
  }
  async saveExport(id: string, data: { exportPath: string; tokenHash: string; tokenExpiresAt: string }) {
    this.records.set(id, {
      tenantId: id,
      status: 'exported',
      approvals: [],
      confirmTokenHash: data.tokenHash,
      tokenExpiresAt: data.tokenExpiresAt,
      exportPath: data.exportPath,
      deleteAfter: null,
    });
  }
  async schedule(id: string, approvals: string[], deleteAfter: string) {
    const rec = this.records.get(id)!;
    rec.status = 'offboarding';
    rec.approvals = approvals;
    rec.deleteAfter = deleteAfter;
    rec.confirmTokenHash = null;
    rec.tokenExpiresAt = null;
  }
  async setTenantStatus(id: string, status: TenantStatus) {
    this.tenants.set(id, status);
  }
  async due(nowIso: string) {
    return [...this.records.values()]
      .filter((r) => r.status === 'offboarding' && r.deleteAfter !== null && r.deleteAfter <= nowIso)
      .map((r) => r.tenantId);
  }
  async markDestroyed(id: string, _data: { approvals: string[]; exportPath: string | null; deletedAt: string }) {
    const rec = this.records.get(id)!;
    rec.status = 'destroyed';
  }
}

const statusOf = (e: unknown) => (e as HttpException).getStatus();

const rejectedStatus = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return statusOf(e);
  }
};

describe('TenantOffboarding', () => {
  let repo: FakeRepo;
  let deleted: string[];
  let audit: Array<{ action: string }>;
  let now: Date;
  let service: TenantOffboarding;

  beforeEach(() => {
    repo = new FakeRepo();
    repo.tenants.set('t1', 'active');
    repo.tenants.set('t2', 'active');
    deleted = [];
    audit = [];
    now = new Date('2026-10-28T00:00:00.000Z');
    service = new TenantOffboarding({
      repo,
      exportPackage: async (id) => `data/tenants/${id}/export.enc`,
      deleteTenant: async (id) => {
        deleted.push(id);
        repo.tenants.set(id, 'terminated');
      },
      audit: { append: async (e) => { audit.push(e); } },
      now: () => now,
      tokenFactory: () => 'token-abc',
    });
  });

  it('export issues a one-time token and stores only its hash', async () => {
    const out = await service.export('t1');
    expect(out.path).toContain('t1');
    expect(out.confirmToken).toBe('token-abc');
    const rec = repo.records.get('t1')!;
    expect(rec.confirmTokenHash).not.toBe('token-abc');
    expect(rec.confirmTokenHash).toHaveLength(64);
    expect(new Date(out.expiresAt).getTime() - now.getTime()).toBe(24 * 3600 * 1000);
    expect(audit.map((a) => a.action)).toContain('tenant.export');
  });

  it('rejects export for an offboarding tenant', async () => {
    repo.tenants.set('t1', 'offboarding');
    expect(await rejectedStatus(service.export('t1'))).toBe(409);
  });

  it('requires a confirm token', async () => {
    await service.export('t1');
    expect(await rejectedStatus(service.destroy('t1', ['a', 'b']))).toBe(400);
  });

  it('requires two distinct approvals', async () => {
    await service.export('t1');
    expect(await rejectedStatus(service.destroy('t1', ['a', 'a'], 'token-abc'))).toBe(409);
  });

  it('rejects an invalid or expired token', async () => {
    await service.export('t1');
    expect(await rejectedStatus(service.destroy('t1', ['a', 'b'], 'wrong'))).toBe(400);
    now = new Date(now.getTime() + 25 * 3600 * 1000);
    expect(await rejectedStatus(service.destroy('t1', ['a', 'b'], 'token-abc'))).toBe(400);
  });

  it('schedules deletion at T+7 instead of deleting now', async () => {
    await service.export('t1');
    const out = await service.destroy('t1', ['ops:alice', 'ops:bob'], 'token-abc');
    expect(out).toMatchObject({ status: 'offboarding', approvals: 2 });
    expect(deleted).toEqual([]);
    expect(repo.tenants.get('t1')).toBe('offboarding');
    const scheduled = new Date(out.scheduledAt!).getTime();
    expect(scheduled - now.getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(repo.records.get('t1')!.confirmTokenHash).toBeNull();
    expect(audit.map((a) => a.action)).toContain('tenant.destroy_scheduled');
  });

  it('repeats destroy idempotently without a token', async () => {
    await service.export('t1');
    const first = await service.destroy('t1', ['a', 'b'], 'token-abc');
    const again = await service.destroy('t1', []);
    expect(again.scheduledAt).toBe(first.scheduledAt);
    expect(deleted).toEqual([]);
  });

  it('does not delete before the scheduled time', async () => {
    await service.export('t1');
    await service.destroy('t1', ['a', 'b'], 'token-abc');
    const early = await service.destroyDue(new Date(now.getTime() + 6 * 24 * 3600 * 1000));
    expect(early.deleted).toEqual([]);
    expect(deleted).toEqual([]);
  });

  it('deletes at T+7, records confirmation, and stays idempotent', async () => {
    await service.export('t1');
    await service.destroy('t1', ['a', 'b'], 'token-abc');
    const due = new Date(now.getTime() + 8 * 24 * 3600 * 1000);
    const first = await service.destroyDue(due);
    expect(first.deleted).toEqual(['t1']);
    expect(deleted).toEqual(['t1']);
    expect(repo.records.get('t1')!.status).toBe('destroyed');
    expect(audit.map((a) => a.action)).toContain('tenant.destroyed');
    const second = await service.destroyDue(due);
    expect(second.deleted).toEqual([]);
  });

  it('keeps sweeping other tenants when one delete fails', async () => {
    repo.tenants.set('t2', 'active');
    await service.export('t1');
    await service.export('t2');
    await service.destroy('t1', ['a', 'b'], 'token-abc');
    await service.destroy('t2', ['a', 'b'], 'token-abc');
    const failing = repo.records.get('t1')!;
    repo.markDestroyed = async (id: string) => {
      if (id === 't1') throw new Error('boom');
      failing.status = 'destroyed';
    };
    const out = await service.destroyDue(new Date(now.getTime() + 8 * 24 * 3600 * 1000));
    expect(out.failed[0].tenantId).toBe('t1');
    expect(out.deleted).toContain('t2');
  });

  it('token from one tenant cannot be reused for another', async () => {
    let seq = 0;
    const scoped = new TenantOffboarding({
      repo,
      exportPackage: async (id) => `data/tenants/${id}/export.enc`,
      deleteTenant: async (id) => { deleted.push(id); repo.tenants.set(id, 'terminated'); },
      audit: { append: async (e) => { audit.push(e); } },
      now: () => now,
      tokenFactory: () => `token-${++seq}`,
    });
    await scoped.export('t1');
    await scoped.export('t2');
    await scoped.destroy('t1', ['a', 'b'], 'token-1');
    expect(await rejectedStatus(scoped.destroy('t2', ['a', 'b'], 'token-1'))).toBe(400);
  });
});
