/** GET /admin/license · POST /admin/license/reload · GET /admin/usage */
import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard.js';
import { LicenseService } from '../license/license.service.js';
import { UsageService } from '../usage/usage.service.js';

@Controller('admin')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class LicenseController {
  constructor(
    private readonly license: LicenseService,
    private readonly usage: UsageService,
  ) {}

  @Get('license')
  @ApiOperation({ summary: '查询 License 状态' })
  @ApiResponse({ status: 200, description: '当前 License 摘要' })
  status() {
    const licenseStatus = this.license.verifyAndCache();
    const usage = this.usage.getUsage();
    return {
      ...licenseStatus,
      currentUsage: {
        messagesReceived: usage.counters.messagesReceived,
        assetsSent: usage.counters.assetsSent,
      },
    };
  }

  @Post('license/reload')
  @ApiOperation({ summary: '重载 License 文件' })
  @ApiResponse({ status: 201, description: '重载结果' })
  reload() { return this.license.reload(); }

  @Get('usage')
  @ApiOperation({ summary: '查询用量统计' })
  @ApiQuery({ name: 'period', required: false, enum: ['daily', 'weekly', 'monthly'] })
  @ApiResponse({ status: 200, description: '所选周期内的用量汇总' })
  getUsage(@Query('period') period?: 'daily' | 'weekly' | 'monthly') {
    return this.usage.getUsage(period);
  }
}
