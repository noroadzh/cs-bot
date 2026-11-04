/**
 * 自助计费：订单持久化 → 支付回调 → renew + 审计
 * 微信/支付宝商户配置走 env；无凭证时 channel=mock（sandbox）
 */
import { BadRequestException, Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { TenantService } from './tenant.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { AppLogger } from '../common/logger.js';
import { randomUUID } from 'crypto';
import {
  type PaymentChannel,
  type PrepayArtifacts,
  resolvePaymentProvider,
} from './billing/payment-provider.js';

export type { PaymentChannel };

export interface BillingOrder {
  id: string;
  tenantId: string;
  days: number;
  amountCents: number;
  channel: PaymentChannel;
  status: 'created' | 'paid' | 'failed';
  createdAt: string;
  paidAt?: string;
}

export type CreateOrderResult = BillingOrder & { prepay?: PrepayArtifacts };

@Injectable()
export class BillingService implements OnModuleDestroy {
  private readonly logger = new AppLogger('BillingService');
  private readonly pool: Pool;

  constructor(
    private readonly tenants: TenantService,
    private readonly audit: PlatformAuditService,
    @Optional() pool?: Pool,
  ) {
    this.pool =
      pool ??
      new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 5 });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }

  paymentConfigured(): boolean {
    return this.channelConfigured('wechat') || this.channelConfigured('alipay');
  }

  channelConfigured(channel: PaymentChannel): boolean {
    return resolvePaymentProvider(channel).configured();
  }

  async createOrder(input: {
    tenantId: string;
    days: number;
    amountCents: number;
    channel?: PaymentChannel;
  }): Promise<CreateOrderResult> {
    const channel: PaymentChannel =
      input.channel ?? (this.channelConfigured('wechat') ? 'wechat' : 'mock');
    const provider = resolvePaymentProvider(channel);
    if (channel !== 'mock' && !provider.configured()) {
      throw new Error(`payment channel ${channel} is not configured`);
    }
    const id = randomUUID();
    const res = await this.pool.query(
      `INSERT INTO billing_order
         (id, tenant_id, days, amount_cents, channel, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'created',now())
       RETURNING id, tenant_id, days, amount_cents, channel, status, created_at, paid_at`,
      [id, input.tenantId, input.days, input.amountCents, channel],
    );
    const order = mapRow(res.rows[0]);
    if (channel === 'mock') {
      return order;
    }
    const prepay = provider.createPrepay(order);
    return { ...order, prepay };
  }

  /** mock 直付：无凭证或 channel=mock；真实渠道须走 webhook */
  mockPayAllowed(order: BillingOrder): boolean {
    if (order.channel === 'mock') return true;
    return !this.paymentConfigured();
  }

  async mockPay(orderId: string): Promise<BillingOrder> {
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new BadRequestException({ errCode: 'ORDER_NOT_FOUND' });
    }
    if (!this.mockPayAllowed(order)) {
      throw new BadRequestException({ errCode: 'PAYMENT_USE_WEBHOOK' });
    }
    return this.markPaid(orderId, 'mock-pay');
  }

  async markPaid(orderId: string, actor = 'payment-webhook'): Promise<BillingOrder> {
    const existing = await this.getOrder(orderId);
    if (!existing) throw new Error(`order ${orderId} not found`);
    if (existing.status === 'paid') return existing;

    await this.tenants.renew(existing.tenantId, existing.days, actor);

    const res = await this.pool.query(
      `UPDATE billing_order
          SET status = 'paid', paid_at = now()
        WHERE id = $1 AND status <> 'paid'
        RETURNING id, tenant_id, days, amount_cents, channel, status, created_at, paid_at`,
      [orderId],
    );
    const order = res.rows[0] ? mapRow(res.rows[0]) : existing;
    order.status = 'paid';
    order.paidAt = order.paidAt ?? new Date().toISOString();

    await this.audit.append({
      action: 'tenant.renew',
      actor,
      tenantId: order.tenantId,
      payload: { orderId, days: order.days, channel: order.channel, billing: true },
    });
    this.logger.log({ detail: 'billing-paid', orderId, tenantId: order.tenantId });
    return order;
  }

  async getOrder(id: string): Promise<BillingOrder | undefined> {
    const res = await this.pool.query(
      `SELECT id, tenant_id, days, amount_cents, channel, status, created_at, paid_at
         FROM billing_order WHERE id = $1`,
      [id],
    );
    return res.rows[0] ? mapRow(res.rows[0]) : undefined;
  }
}

function mapRow(row: Record<string, unknown>): BillingOrder {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    days: Number(row.days),
    amountCents: Number(row.amount_cents),
    channel: row.channel as PaymentChannel,
    status: row.status as BillingOrder['status'],
    createdAt: new Date(row.created_at as string).toISOString(),
    paidAt: row.paid_at ? new Date(row.paid_at as string).toISOString() : undefined,
  };
}
