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
