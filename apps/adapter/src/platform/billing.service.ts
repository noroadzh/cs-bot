/**
 * 自助计费：订单持久化 → 支付回调 → renew + 审计
 * 微信/支付宝商户配置走 env；无凭证时 channel=mock（sandbox）
 */
import { Injectable, Optional, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { TenantService } from './tenant.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { AppLogger } from '../common/logger.js';
import { randomUUID } from 'crypto';

export type PaymentChannel = 'wechat' | 'alipay' | 'mock';

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
    const cfg = ConfigService.instance;
    return Boolean(
      (cfg.PAYMENT_WECHAT_MCH_ID && cfg.PAYMENT_WECHAT_API_KEY) ||
        (cfg.PAYMENT_ALIPAY_APP_ID && cfg.PAYMENT_ALIPAY_PRIVATE_KEY),
    );
  }

  async createOrder(input: {
    tenantId: string;
    days: number;
    amountCents: number;
    channel?: PaymentChannel;
  }): Promise<BillingOrder> {
    const channel: PaymentChannel =
      input.channel ?? (this.paymentConfigured() ? 'wechat' : 'mock');
    const id = randomUUID();
    const res = await this.pool.query(
      `INSERT INTO billing_order
         (id, tenant_id, days, amount_cents, channel, status, created_at)
       VALUES ($1,$2,$3,$4,$5,'created',now())
       RETURNING id, tenant_id, days, amount_cents, channel, status, created_at, paid_at`,
      [id, input.tenantId, input.days, input.amountCents, channel],
    );
    return mapRow(res.rows[0]);
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
