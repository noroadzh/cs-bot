/** GET /admin/miss-records · PATCH /admin/miss/:id */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminGuard } from './admin.guard.js';
import { MissExportService } from '../miss/miss-export.service.js';
import { MissService } from '../miss/miss.service.js';
import { ErrorResponseDto } from '../common/dto/error-response.dto.js';
import { MissExportDto } from './dto/miss-export.dto.js';
import { MissRecordsQueryDto } from './dto/miss-records-query.dto.js';

@Controller('admin')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class MissController {
  constructor(
    private readonly exportService: MissExportService,
    private readonly missService: MissService,
  ) {}

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
    const items = await this.exportService.queryItems(daysNum, range);
    res.setHeader('Content-Type', 'application/json');
    res.json({ total: items.length, items });
  }

  @Patch('miss/:id')
  @ApiOperation({ summary: '更新未命中处理状态（0 未处理 / 1 已补录 / 2 忽略）' })
  @ApiResponse({
    status: 200,
    description: '更新后的状态',
    schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
  })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'status 非法' })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: '记录不存在' })
  async updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { status?: number },
  ): Promise<{ id: number; status: number }> {
    const status = body?.status;
    if (status !== 0 && status !== 1 && status !== 2) {
      throw new BadRequestException({ errCode: 'MISS_STATUS_INVALID', detail: 'status must be 0, 1, or 2' });
    }
    const ok = await this.missService.updateStatus(id, status);
    if (!ok) {
      throw new NotFoundException({ errCode: 'MISS_NOT_FOUND', detail: `miss ${id} not found` });
    }
    return { id, status };
  }
}
