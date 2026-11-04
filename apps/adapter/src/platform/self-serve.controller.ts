/**
 * 自助注册 / 支付（控制面半公开）
 */
import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '../config/config.service.js';
import { TenantService } from './tenant.service.js';
import { BillingService } from './billing.service.js';

@Controller('self-serve')
@ApiTags('self-serve')
export class SelfServeController {
  constructor(
    private readonly tenants: TenantService,
    private readonly billing: BillingService,
  ) {}

  private assertEnabled(): void {
    if (!ConfigService.instance.SELF_SERVE_ENABLED) {
      throw new BadRequestException({ errCode: 'SELF_SERVE_DISABLED' });
    }
  }

  @Post('register')
  @ApiOperation({ summary: '自助注册租户（邮箱验证占位：contact=email）' })
  async register(
    @Body()
    body: {
      name: string;
      email: string;
      plan?: string;
      tenancyMode?: 'dedicated' | 'shared';
      fingerprint?: string;
    },
  ) {
    this.assertEnabled();
    if (!body.email || !body.email.includes('@')) {
      throw new BadRequestException({ errCode: 'EMAIL_INVALID' });
    }
    const tenant = await this.tenants.create(
      {
        name: body.name,
        contact: body.email,
        plan: body.plan,
        tenancyMode: body.tenancyMode,
        fingerprint: body.fingerprint,
      },
      'self-serve',
    );
    return { tenantId: tenant.id, status: tenant.status, email: body.email, verified: false };
  }

  @Post('orders')
  async createOrder(
    @Body() body: { tenantId: string; days: number; amountCents: number; channel?: 'wechat' | 'alipay' | 'mock' },
  ) {
    this.assertEnabled();
    return this.billing.createOrder(body);
  }

  @Post('orders/:id/pay')
  @ApiOperation({ summary: '支付成功回调（sandbox / mock）' })
  async pay(@Param('id') id: string) {
    this.assertEnabled();
    return this.billing.markPaid(id);
  }

  @Get('orders/:id')
  async getOrder(@Param('id') id: string) {
    this.assertEnabled();
    return (await this.billing.getOrder(id)) ?? { errCode: 'ORDER_NOT_FOUND' };
  }
}
