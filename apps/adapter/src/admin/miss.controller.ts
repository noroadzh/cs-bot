/** GET /admin/miss-records */
import { Controller, Get, Query, UseGuards, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AdminGuard } from './admin.guard.js';
import { MissExportService } from '../miss/miss-export.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class MissController {
  constructor(private readonly exportService: MissExportService) {}

  @Get('miss-records')
  async list(@Query('format') format: string, @Query('days') days: string, @Res() res: Response) {
    const daysNum = parseInt(days ?? '90', 10);
    const rows = await this.exportService.queryRecords(daysNum);
    res.setHeader('Content-Type', 'application/json');
    res.json({ total: rows.length, rows });
    void format;
  }
}
