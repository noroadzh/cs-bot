/** GET /admin/miss-records */
import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminGuard } from './admin.guard.js';
import { MissExportService } from '../miss/miss-export.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { MissExportDto } from './dto/miss-export.dto.js';
import { MissRecordsQueryDto } from './dto/miss-records-query.dto.js';

@Controller('admin')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class MissController {
  constructor(private readonly exportService: MissExportService) {}

  @Get('miss-records')
  @ApiOperation({ summary: '导出未识别消息记录' })
  @ApiResponse({ status: 200, type: MissExportDto, description: 'JSON 导出结果' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'days 参数非正整数或 format 无效' })
  async list(
    @Query() query: MissRecordsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const format = query.format;
    const days = query.days;
    const daysNum = parseInt(days ?? '90', 10);
    const range = query.from || query.to ? { from: query.from, to: query.to } : undefined;
    if ((format ?? 'json').toLowerCase() === 'xlsx') {
      await this.exportService.exportXlsx(daysNum, res as unknown as NodeJS.WritableStream & { setHeader?: (k: string, v: string) => void }, range);
      return;
    }
    const rows = await this.exportService.queryRecords(daysNum, range);
    res.setHeader('Content-Type', 'application/json');
    res.json({ total: rows.length, rows });
  }
}
