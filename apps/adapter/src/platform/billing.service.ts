/**
 * 自助计费：订单 → 支付回调 → renew
 * 微信/支付宝商户配置走 env；无凭证时仅记录订单状态供单测
 */
import { Injectable, Optional } from '@nestjs/common';
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
export class BillingService {
  private readonly logger = new AppLogger('BillingService');
  private readonly orders = new Map<string, BillingOrder>();

  constructor(
    private readonly tenants: TenantService,
    private readonly audit: PlatformAuditService,
    @Optional() _config?: ConfigService,
  ) {}

  paymentConfigured(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(
      (cfg.PAYMENT_WECHAT_MCH_ID && cfg.PAYMENT_WECHAT_API_KEY) ||
        (cfg.PAYMENT_ALIPAY_APP_ID && cfg.PAYMENT_ALIPAY_PRIVATE_KEY),
    );
  }

  createOrder(input: {
    tenantId: string;
    days: number;
    amountCents: number;
    channel?: PaymentChannel;
  }): BillingOrder {
    const channel: PaymentChannel =
      input.channel ?? (this.paymentConfigured() ? 'wechat' : 'mock');
    const order: BillingOrder = {
      id: randomUUID(),
      tenantId: input.tenantId,
      days: input.days,
      amountCents: input.amountCents,
      channel,
      status: 'created',
      createdAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    return order;
  }

  async markPaid(orderId: string, actor = 'payment-webhook'): Promise<BillingOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`order ${orderId} not found`);
    if (order.status === 'paid') return order;
    await this.tenants.renew(order.tenantId, order.days, actor);
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    await this.audit.append({
      action: 'tenant.renew',
      actor,
      tenantId: order.tenantId,
      payload: { orderId, days: order.days, channel: order.channel, billing: true },
    });
    this.logger.log({ detail: 'billing-paid', orderId, tenantId: order.tenantId });
    return order;
  }

  getOrder(id: string): BillingOrder | undefined {
    return this.orders.get(id);
  }
}
