import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { BillingService } from '../src/platform/billing.service.js';
import { ArchiveService } from '../src/archive/archive.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

describe('Billing + archive + shared fingerprint helper', () => {
  beforeEach(() => setConfig({ SELF_SERVE_ENABLED: true }));
  afterEach(() => resetConfig());

  it('支付成功调用 renew 并记审计', async () => {
    const tenants = { renew: jest.fn(async () => ({ id: 't1' })) };
    const audit = { append: jest.fn(async () => undefined) };
    const billing = new BillingService(tenants as any, audit as any);
    const order = billing.createOrder({ tenantId: 't1', days: 30, amountCents: 1000, channel: 'mock' });
    const paid = await billing.markPaid(order.id);
    expect(paid.status).toBe('paid');
    expect(tenants.renew.mock.calls[0]).toEqual(['t1', 30, 'payment-webhook']);
    expect(audit.append.mock.calls.length).toBe(1);
  });

  it('存档批量入队', () => {
    const archive = new ArchiveService();
    const res = archive.enqueue([
      { msgId: '1', chatId: 'c', from: 'u', content: 'hi', msgTime: Date.now() },
    ]);
    expect(res.count).toBe(1);
    expect(archive.listJobs().length).toBe(1);
  });
});
