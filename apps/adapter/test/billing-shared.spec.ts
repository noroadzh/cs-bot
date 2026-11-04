import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { BillingService } from '../src/platform/billing.service.js';
import { ArchiveService } from '../src/archive/archive.service.js';
import { tenantRedisKey, currentTenantId } from '../src/common/tenant-scope.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

function makeBillingPool() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO billing_order')) {
        const row = {
          id: params[0],
          tenant_id: params[1],
          days: params[2],
          amount_cents: params[3],
          channel: params[4],
          status: 'created',
          created_at: new Date().toISOString(),
          paid_at: null,
        };
        store.set(String(params[0]), row);
        return { rows: [row] };
      }
      if (sql.includes('FROM billing_order WHERE id')) {
        const row = store.get(String(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes('UPDATE billing_order')) {
        const row = store.get(String(params[0]));
        if (!row || row.status === 'paid') return { rows: row ? [row] : [] };
        row.status = 'paid';
        row.paid_at = new Date().toISOString();
        return { rows: [row] };
      }
      return { rows: [] };
    }),
    end: jest.fn(async () => undefined),
  };
}

describe('Billing + archive + shared tenant scope', () => {
  beforeEach(() => setConfig({ SELF_SERVE_ENABLED: true }));
  afterEach(() => resetConfig());

  it('支付成功落库、调用 renew 并记审计', async () => {
    const tenants = { renew: jest.fn(async () => ({ id: 't1' })) };
    const audit = { append: jest.fn(async () => undefined) };
    const pool = makeBillingPool();
    const billing = new BillingService(tenants as any, audit as any, pool as any);
    const order = await billing.createOrder({
      tenantId: 't1',
      days: 30,
      amountCents: 1000,
      channel: 'mock',
    });
    const paid = await billing.markPaid(order.id);
    expect(paid.status).toBe('paid');
    expect(tenants.renew.mock.calls[0]).toEqual(['t1', 30, 'payment-webhook']);
    expect(audit.append.mock.calls.length).toBe(1);
    expect(pool.query.mock.calls.some((c) => String(c[0]).includes('INSERT'))).toBe(true);
  });

  it('存档批量入队创建 import 任务', async () => {
    const createFromFile = jest.fn(async (_input: { mimeType: string }) => ({
      job: { id: 'import-job-1' },
      reused: false,
    }));
    const archive = new ArchiveService({ createFromFile } as any);
    const res = await archive.enqueue([
      { msgId: '1', chatId: 'c', from: 'u', content: 'hi', msgTime: Date.now() },
    ]);
    expect(res.jobId).toBe('import-job-1');
    expect(res.count).toBe(1);
    expect(createFromFile.mock.calls[0]?.[0].mimeType).toBe('application/json');
    expect(archive.listJobs()[0]?.id).toBe('import-job-1');
  });

  it('tenant redis 前缀与 currentTenantId 隔离', () => {
    setConfig({ TENANT_ID: 'tenant-a' });
    expect(currentTenantId()).toBe('tenant-a');
    expect(tenantRedisKey('ctx:c:u')).toBe('t:tenant-a:ctx:c:u');
    setConfig({ TENANT_ID: 'tenant-b' });
    expect(tenantRedisKey('ctx:c:u')).toBe('t:tenant-b:ctx:c:u');
    setConfig({ TENANT_ID: '' });
    expect(tenantRedisKey('ctx:c:u')).toBe('ctx:c:u');
  });
});
