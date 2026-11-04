/**
 * 微信 / 支付宝支付结果 webhook（无 Basic Auth，验签 + 幂等 markPaid）
 */
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BillingService } from './billing.service.js';
import { verifyPaymentWebhook } from './billing/payment-provider.js';

type WebhookBody = {
  orderId: string;
  amountCents: number;
  signature: string;
};

@Controller('self-serve/webhooks')
@ApiTags('self-serve')
export class SelfServeWebhooksController {
  constructor(private readonly billing: BillingService) {}

  @Post('wechat')
  @ApiOperation({ summary: '微信支付结果通知（验签占位）' })
  async wechat(@Body() body: WebhookBody) {
    return this.handle('wechat', body, 'wechat-webhook');
  }

  @Post('alipay')
  @ApiOperation({ summary: '支付宝支付结果通知（验签占位）' })
  async alipay(@Body() body: WebhookBody) {
    return this.handle('alipay', body, 'alipay-webhook');
  }

  private async handle(
    channel: 'wechat' | 'alipay',
    body: WebhookBody,
    actor: string,
  ) {
    const orderId = body?.orderId?.trim();
    const amountCents = Number(body?.amountCents);
    const signature = String(body?.signature ?? '');
    if (!orderId || !Number.isFinite(amountCents)) {
      throw new BadRequestException({ errCode: 'PAYMENT_PAYLOAD_INVALID' });
    }
    if (!this.billing.channelConfigured(channel)) {
      throw new BadRequestException({ errCode: 'PAYMENT_NOT_CONFIGURED' });
    }
    if (!verifyPaymentWebhook(channel, orderId, amountCents, signature)) {
      throw new BadRequestException({ errCode: 'PAYMENT_SIGNATURE_INVALID' });
    }
    const order = await this.billing.getOrder(orderId);
    if (!order) {
      throw new BadRequestException({ errCode: 'ORDER_NOT_FOUND' });
    }
    if (order.amountCents !== amountCents) {
      throw new BadRequestException({ errCode: 'PAYMENT_AMOUNT_MISMATCH' });
    }
    if (order.channel !== channel) {
      throw new BadRequestException({ errCode: 'PAYMENT_CHANNEL_MISMATCH' });
    }
    const paid = await this.billing.markPaid(orderId, actor);
    return { ok: true, orderId: paid.id, status: paid.status };
  }
}
