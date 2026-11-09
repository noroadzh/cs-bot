/** GET /platform/audit-logs — request-level (distinct from chained /platform/audit-log) */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { RolesGuard } from '../admin/roles.guard.js';
import { Roles } from '../admin/roles.decorator.js';
import { AdminRequestAuditService } from '../admin/admin-request-audit.service.js';
import { PlatformEnabledGuard } from './platform.controller.js';

@Controller('platform/audit-logs')
@ApiTags('platform')
@UseGuards(PlatformEnabledGuard, AdminGuard, RolesGuard)
@Roles('admin')
export class PlatformRequestAuditController {
  constructor(private readonly audit: AdminRequestAuditService) {}

  @Get()
  @ApiOperation({ summary: '查询控制面请求级审计' })
  async list(
    @Query('username') username?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list({
      username,
      from,
      to,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
