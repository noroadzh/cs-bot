import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { BillingService } from '../src/platform/billing.service.js';
import {
  signPaymentWebhook,
  verifyPaymentWebhook,
} from '../src/platform/billing/payment-provider.js';
import { SelfServeWebhooksController } from '../src/platform/self-serve-webhooks.controller.js';
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

describe('platform billing providers', () => {
  beforeEach(() => setConfig({ SELF_SERVE_ENABLED: true }));
  afterEach(() => resetConfig());

  it('微信预下单不 markPaid，webhook 验签成功后续费', async () => {
    setConfig({
      PAYMENT_WECHAT_MCH_ID: 'mch-1',
      PAYMENT_WECHAT_API_KEY: 'wx-key-12345678',
    });
    const renew = jest.fn(async (_id: string, _days: number, _actor?: string) => ({ id: 't1' }));
    const tenants = { renew };
    const audit = { append: jest.fn(async () => undefined) };
    const pool = makeBillingPool();
    const billing = new BillingService(tenants as any, audit as any, pool as any);
    const created = await billing.createOrder({
      tenantId: 't1',
      days: 30,
      amountCents: 9900,
      channel: 'wechat',
    });
    expect(created.status).toBe('created');
    expect(created.prepay?.provider).toBe('wechat');
    expect(renew).not.toHaveBeenCalled();

    const sig = signPaymentWebhook('wechat', created.id, 9900);
    const webhooks = new SelfServeWebhooksController(billing);
    const res = await webhooks.wechat({
      orderId: created.id,
      amountCents: 9900,
      signature: sig,
    });
    expect(res.status).toBe('paid');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(audit.append).toHaveBeenCalledTimes(1);

    await webhooks.wechat({
      orderId: created.id,
      amountCents: 9900,
      signature: sig,
    });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it('无效 webhook 签名拒绝且订单不变', async () => {
    setConfig({
      PAYMENT_WECHAT_MCH_ID: 'mch-1',
      PAYMENT_WECHAT_API_KEY: 'wx-key-12345678',
    });
    const renew = jest.fn(async (_id: string, _days: number, _actor?: string) => ({ id: 't1' }));
    const tenants = { renew };
    const audit = { append: jest.fn(async () => undefined) };
    const pool = makeBillingPool();
    const billing = new BillingService(tenants as any, audit as any, pool as any);
    const created = await billing.createOrder({
      tenantId: 't1',
      days: 7,
      amountCents: 100,
      channel: 'wechat',
    });
    const webhooks = new SelfServeWebhooksController(billing);
    try {
      await webhooks.wechat({ orderId: created.id, amountCents: 100, signature: 'bad' });
      throw new Error('expected throw');
    } catch (e: unknown) {
      const ex = e as BadRequestException;
      expect(ex.getResponse()).toMatchObject({ errCode: 'PAYMENT_SIGNATURE_INVALID' });
    }
    expect(renew).not.toHaveBeenCalled();
    expect(verifyPaymentWebhook('wechat', created.id, 100, 'bad')).toBe(false);
  });

  it('无凭证 mock 通道可走 pay 端点', async () => {
    const renew = jest.fn(async (_id: string, _days: number, _actor?: string) => ({ id: 't1' }));
    const tenants = { renew };
    const audit = { append: jest.fn(async () => undefined) };
    const pool = makeBillingPool();
    const billing = new BillingService(tenants as any, audit as any, pool as any);
    const order = await billing.createOrder({
      tenantId: 't1',
      days: 14,
      amountCents: 500,
      channel: 'mock',
    });
    expect(order.prepay).toBeUndefined();
    const paid = await billing.mockPay(order.id);
    expect(paid.status).toBe('paid');
    expect(renew.mock.calls[0]).toEqual(['t1', 14, 'mock-pay']);
  });

  it('已配置真实支付时 mock pay 拒绝', async () => {
    setConfig({
      SELF_SERVE_ENABLED: true,
      PAYMENT_WECHAT_MCH_ID: 'mch-1',
      PAYMENT_WECHAT_API_KEY: 'wx-key-12345678',
    });
    const renew = jest.fn(async (_id: string, _days: number, _actor?: string) => ({ id: 't1' }));
    const tenants = { renew };
    const audit = { append: jest.fn(async () => undefined) };
    const pool = makeBillingPool();
    const billing = new BillingService(tenants as any, audit as any, pool as any);
    const order = await billing.createOrder({
      tenantId: 't1',
      days: 30,
      amountCents: 1000,
      channel: 'wechat',
    });
    try {
      await billing.mockPay(order.id);
      throw new Error('expected throw');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({
        errCode: 'PAYMENT_USE_WEBHOOK',
      });
    }
  });
});
