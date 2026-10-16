/** GET /admin/miss-records */
import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminGuard } from './admin.guard.js';
import { MissExportService } from '../miss/miss-export.service.js';

@Controller('admin')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class MissController {
  constructor(private readonly exportService: MissExportService) {}

  @Get('miss-records')
  @ApiOperation({ summary: '导出未识别消息记录' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'xlsx'] })
  @ApiQuery({ name: 'days', required: false, description: '回溯天数，默认 90' })
  @ApiResponse({ status: 200, description: '文件下载' })
  async list(
    @Query('format') format: string | undefined,
    @Query('days') days: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const daysNum = parseInt(days ?? '90', 10);
    if ((format ?? 'json').toLowerCase() === 'xlsx') {
      await this.exportService.exportXlsx(daysNum, res as unknown as NodeJS.WritableStream & { setHeader?: (k: string, v: string) => void });
      return;
    }
    const rows = await this.exportService.queryRecords(daysNum);
    res.setHeader('Content-Type', 'application/json');
    res.json({ total: rows.length, rows });
  }
}
