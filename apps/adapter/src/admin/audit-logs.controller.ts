/** GET /admin/audit-logs — request-level management audit */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard.js';
import { RolesGuard } from './roles.guard.js';
import { Roles } from './roles.decorator.js';
import { AdminRequestAuditService } from './admin-request-audit.service.js';

@Controller('admin/audit-logs')
@ApiTags('admin')
@UseGuards(AdminGuard, RolesGuard)
@Roles('admin')
export class AuditLogsController {
  constructor(private readonly audit: AdminRequestAuditService) {}

  @Get()
  @ApiOperation({ summary: '查询请求级管理审计' })
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
