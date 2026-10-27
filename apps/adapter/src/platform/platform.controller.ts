/**
 * PlatformController — M11 控制面 HTTP 端点
 *
 * 所有路由挂 AdminGuard（Basic Auth + IP whitelist）与 PlatformEnabledGuard（PLATFORM_ENABLED=false 时整体 404）。
 */
import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  HttpCode,
  HttpStatus,
  Query,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../admin/admin.guard.js';
import { ConfigService } from '../config/config.service.js';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  TenantService,
} from './tenant.service.js';
import {
  TenantQuotaService,
  type QuotaConsumeInput,
  type QuotaKind,
} from './tenant-quota.service.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { TenantExpirySweepService } from './tenant-expiry-sweep.service.js';
import { TenantUsageService } from './tenant-usage.service.js';
import { UpgradeOrchestrator } from './upgrade-orchestrator.js';
import { PlatformMonitor } from './platform-monitor.js';
import { TenantOffboarding } from './tenant-offboarding.js';
import { TenantSecretsService } from './tenant-secrets.service.js';

/** PLATFORM_ENABLED=false 时所有 /platform 路由 404 */
@Injectable()
export class PlatformEnabledGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    if (!ConfigService.instance.PLATFORM_ENABLED) {
      throw new NotFoundException({ errCode: 'PLATFORM_DISABLED', detail: 'platform control-plane is disabled' });
    }
    return true;
  }
}

@Controller('platform')
@ApiBearerAuth()
@ApiTags('platform')
@UseGuards(PlatformEnabledGuard, AdminGuard)
export class PlatformController {
  constructor(
    private readonly tenants: TenantService,
    private readonly quota: TenantQuotaService,
    private readonly audit: PlatformAuditService,
    private readonly sweep: TenantExpirySweepService,
    private readonly usageService: TenantUsageService,
    private readonly upgrade: UpgradeOrchestrator,
    private readonly monitor: PlatformMonitor,
    private readonly offboarding: TenantOffboarding,
    private readonly secrets: TenantSecretsService,
  ) {}

  private actor(req: Request): string {
    // Basic Auth 已由 AdminGuard 校验；用 user 名作为 actor
    const auth = (req.headers?.authorization ?? '') as string;
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      return decoded.split(':')[0] || 'admin';
    } catch {
      return 'admin';
    }
  }

  // -----------------------------------------------------------------------
  // Tenant CRUD + lifecycle
  // -----------------------------------------------------------------------

  @Post('tenants')
  @ApiOperation({ summary: '创建租户' })
  async create(@Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.tenants.create(
      {
        name: String(body.name ?? ''),
        contact: body.contact === undefined ? undefined : String(body.contact),
        plan: body.plan === undefined ? undefined : String(body.plan),
        subscriptionExpiresAt:
          body.subscriptionExpiresAt === undefined ? undefined : String(body.subscriptionExpiresAt),
      },
      this.actor(req),
    );
  }

  @Get('tenants')
  @ApiOperation({ summary: '租户列表（分页 + status 过滤）' })
  async list(
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const limit = limitStr === undefined ? undefined : parseInt(limitStr, 10);
    const offset = offsetStr === undefined ? undefined : parseInt(offsetStr, 10);
    return this.tenants.list(status, limit, offset);
  }

  @Get('tenants/:id')
  @ApiOperation({ summary: '租户详情（含配额与当日用量）' })
  async detail(@Param('id') id: string) {
    return this.tenants.getDetail(id);
  }

  @Put('tenants/:id/secrets')
  @ApiOperation({ summary: '设置/更新租户密钥（企微/LLM/FastGPT，值不回显）' })
  async updateSecrets(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const updated = await this.secrets.update(id, body);
    return { ok: true, updated };
  }

  @Post('tenants/:id/restart')
  @ApiOperation({ summary: '重启租户 adapter（更新密钥/FastGPT 初始化后生效）' })
  async restartTenant(@Param('id') id: string, @Req() req: Request) {
    await this.tenants.restart(id, this.actor(req));
    return { ok: true };
  }

  @Post('tenants/:id/provision')
  @ApiOperation({ summary: '编排开通租户实例（docker compose up + probe）' })
  async provision(@Param('id') id: string, @Req() req: Request) {
    return this.tenants.provision(id, this.actor(req));
  }

  @Post('tenants/:id/renew')
  @ApiOperation({ summary: '续期订阅' })
  async renew(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    const days = Number(body.days ?? 0);
    return this.tenants.renew(id, days, this.actor(req));
  }

  @Post('tenants/:id/suspend')
  @ApiOperation({ summary: '暂停租户（compose stop + status paused）' })
  async suspend(@Param('id') id: string, @Req() req: Request) {
    return this.tenants.suspend(id, this.actor(req));
  }

  @Post('tenants/:id/resume')
  @ApiOperation({ summary: '恢复租户（compose start + status active）' })
  async resume(@Param('id') id: string, @Req() req: Request) {
    return this.tenants.resume(id, this.actor(req));
  }

  @Post('tenants/:id/terminate')
  @ApiOperation({ summary: '销毁租户（compose down -v + DROP DATABASE）' })
  async terminate(@Param('id') id: string, @Req() req: Request) {
    return this.tenants.terminate(id, this.actor(req));
  }

  // -----------------------------------------------------------------------
  // Quota
  // -----------------------------------------------------------------------

  @Patch('tenants/:id/quota')
  @ApiOperation({ summary: '更新配额（subset of 4 dims）' })
  async setQuota(@Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: Request) {
    return this.quota.setQuota(
      id,
      {
        maxChats: body.maxChats === undefined ? undefined : Number(body.maxChats),
        maxApiCalls: body.maxMsgsPerDay === undefined ? undefined : Number(body.maxMsgsPerDay),
        maxStorageMb: body.maxStorageMb === undefined ? undefined : Number(body.maxStorageMb),
        maxUsers: body.maxConcurrentQa === undefined ? undefined : Number(body.maxConcurrentQa),
        maxLlmTokensPerMonth:
          body.maxLlmTokensPerMonth === undefined ? undefined : Number(body.maxLlmTokensPerMonth),
      },
      this.actor(req),
    );
  }

  @Post('tenants/:id/quota/consume')
  @ApiOperation({ summary: '消耗配额（原子扣减；用于内部或压测验证）' })
  async consume(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const kind = String(body.kind ?? '');
    const delta = body.delta === undefined ? 1 : Number(body.delta);
    return this.quota.consume({ tenantId: id, kind: kind as QuotaConsumeInput['kind'], delta });
  }

  // -----------------------------------------------------------------------
  // Usage
  // -----------------------------------------------------------------------

  @Get('tenants/:id/usage')
  @ApiOperation({ summary: '区间用量查询' })
  async usage(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usageService.queryUsage(id, from, to);
  }

  // -----------------------------------------------------------------------
  // Audit
  // -----------------------------------------------------------------------

  @Get('audit-log')
  @ApiOperation({ summary: '审计日志查询（分页 + tenant_id/action/from/to 过滤）' })
  async auditLog(
    @Query('tenant_id') tenantId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    return this.audit.list({
      tenantId,
      action,
      from,
      to,
      limit: limitStr === undefined ? undefined : parseInt(limitStr, 10),
      offset: offsetStr === undefined ? undefined : parseInt(offsetStr, 10),
    });
  }

  @Get('audit-log/verify')
  @ApiOperation({ summary: '审计链完整性校验' })
  async auditVerify() {
    return this.audit.verifyChain();
  }

  // -----------------------------------------------------------------------
  // Sweep (debug/manual trigger)
  // -----------------------------------------------------------------------

  @Post('sweep')
  @ApiOperation({ summary: '手动触发过期扫描' })
  async triggerSweep() {
    return this.sweep.sweep();
  }

  // -----------------------------------------------------------------------
  // 升级 / 监控 / 注销
  // -----------------------------------------------------------------------

  @Post('report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '适配层用量上报（仅计数，无正文）' })
  async report(@Body() body: Record<string, unknown>) {
    const tenantId = String(body.tenantId ?? '');
    if (!tenantId) return { ok: false, error: 'tenantId required' };
    const day = String(body.date ?? new Date().toISOString().slice(0, 10));
    await this.usageService.upsertReport(tenantId, day, {
      msgsIn: Number(body.msgsIn ?? 0),
      triggered: Number(body.triggered ?? 0),
      hit: Number(body.hit ?? 0),
      miss: Number(body.miss ?? 0),
      tokens: Number(body.tokens ?? 0),
      activeChats: Number(body.activeChats ?? 0),
    });
    return { ok: true };
  }

  @Post('upgrades')
  @ApiOperation({ summary: '批量升级（金丝雀 + 批次 + 回滚）' })
  async upgrades(@Body() body: Record<string, unknown>) {
    const tenantIds = Array.isArray(body.tenantIds)
      ? (body.tenantIds as string[])
      : (await this.tenants.list()).rows.map((t) => t.id);
    return this.upgrade.run(tenantIds, String(body.tag ?? 'latest'));
  }

  @Get('usage')
  @ApiOperation({ summary: '平台总览（租户数/健康/异常实例）' })
  async platformUsage() {
    const ids = (await this.tenants.list()).rows.map((t) => t.id);
    return this.monitor.collect(ids);
  }

  @Post('tenants/:id/export')
  @ApiOperation({ summary: '导出租户数据加密包' })
  async exportTenant(@Param('id') id: string) {
    return { path: await this.offboarding.export(id) };
  }

  @Post('tenants/:id/destroy')
  @ApiOperation({ summary: '注销租户（双签 + 删除）' })
  async destroyTenant(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const approvals = Array.isArray(body.approvals) ? (body.approvals as string[]) : [];
    return this.offboarding.destroy(id, approvals);
  }
}
