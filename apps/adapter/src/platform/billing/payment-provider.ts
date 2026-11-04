/**
 * 支付渠道适配（mock | 微信 | 支付宝）
 * 真实 SDK 预下单与验签在此隔离；无凭证时走 mock。
 */
import { createHmac, randomBytes } from 'node:crypto';
import { ConfigService } from '../../config/config.service.js';
export type PaymentChannel = 'wechat' | 'alipay' | 'mock';

export interface PrepayOrderInput {
  id: string;
  amountCents: number;
}

export interface PrepayArtifacts {
  provider: 'wechat' | 'alipay' | 'mock';
  /** 客户端调起支付所需字段（占位结构，接入官方 SDK 时替换） */
  payload: Record<string, string>;
}

export interface PaymentProvider {
  readonly channel: PaymentChannel;
  configured(): boolean;
  createPrepay(order: PrepayOrderInput): PrepayArtifacts;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly channel = 'mock' as const;

  configured(): boolean {
    return true;
  }

  createPrepay(order: PrepayOrderInput): PrepayArtifacts {
    return {
      provider: 'mock',
      payload: { orderId: order.id, hint: 'POST /self-serve/orders/:id/pay' },
    };
  }
}

export class WechatPaymentProvider implements PaymentProvider {
  readonly channel = 'wechat' as const;

  configured(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(cfg.PAYMENT_WECHAT_MCH_ID && cfg.PAYMENT_WECHAT_API_KEY);
  }

  createPrepay(order: PrepayOrderInput): PrepayArtifacts {
    if (!this.configured()) {
      throw new Error('wechat payment not configured');
    }
    const cfg = ConfigService.instance;
    const nonceStr = randomBytes(8).toString('hex');
    const timeStamp = String(Math.floor(Date.now() / 1000));
    const prepayId = `wx_prepay_${order.id.replace(/-/g, '')}`;
    const pkg = `prepay_id=${prepayId}`;
    // TODO: 接入微信支付 v3 RSA 签名；当前为商户 API v2 风格占位
    const paySign = createHmac('sha256', cfg.PAYMENT_WECHAT_API_KEY)
      .update(`${cfg.PAYMENT_WECHAT_MCH_ID}|${prepayId}|${nonceStr}|${timeStamp}`)
      .digest('hex');
    return {
      provider: 'wechat',
      payload: {
        appId: cfg.PAYMENT_WECHAT_MCH_ID,
        timeStamp,
        nonceStr,
        package: pkg,
        signType: 'HMAC-SHA256',
        paySign,
        outTradeNo: order.id,
      },
    };
  }
}

export class AlipayPaymentProvider implements PaymentProvider {
  readonly channel = 'alipay' as const;

  configured(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(cfg.PAYMENT_ALIPAY_APP_ID && cfg.PAYMENT_ALIPAY_PRIVATE_KEY);
  }

  createPrepay(order: PrepayOrderInput): PrepayArtifacts {
    if (!this.configured()) {
      throw new Error('alipay payment not configured');
    }
    const cfg = ConfigService.instance;
    const amountYuan = (order.amountCents / 100).toFixed(2);
    // TODO: alipay-sdk 生成 orderString；当前为 query 串占位
    const orderString =
      `app_id=${cfg.PAYMENT_ALIPAY_APP_ID}` +
      `&out_trade_no=${order.id}` +
      `&total_amount=${amountYuan}` +
      `&subject=cs-bot-renew` +
      `&product_code=QUICK_MSECURITY_PAY`;
    return {
      provider: 'alipay',
      payload: { orderString, outTradeNo: order.id },
    };
  }
}

export function resolvePaymentProvider(channel: PaymentChannel): PaymentProvider {
  switch (channel) {
    case 'wechat':
      return new WechatPaymentProvider();
    case 'alipay':
      return new AlipayPaymentProvider();
    default:
      return new MockPaymentProvider();
  }
}

/** Webhook 验签占位：HMAC-SHA256(secret, `${orderId}:${amountCents}`) */
export function paymentWebhookSecret(channel: 'wechat' | 'alipay'): string {
  const cfg = ConfigService.instance;
  if (channel === 'wechat') return cfg.PAYMENT_WECHAT_API_KEY;
  return cfg.PAYMENT_ALIPAY_PRIVATE_KEY;
}

export function signPaymentWebhook(
  channel: 'wechat' | 'alipay',
  orderId: string,
  amountCents: number,
): string {
  const secret = paymentWebhookSecret(channel);
  return createHmac('sha256', secret).update(`${orderId}:${amountCents}`).digest('hex');
}

export function verifyPaymentWebhook(
  channel: 'wechat' | 'alipay',
  orderId: string,
  amountCents: number,
  signature: string,
): boolean {
  if (!signature || !paymentWebhookSecret(channel)) return false;
  const expected = signPaymentWebhook(channel, orderId, amountCents);
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
