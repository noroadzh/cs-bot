import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { ArchiveService, type ArchiveMessage } from './archive.service.js';

@Controller('admin/archive')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Post('ingest')
  @ApiOperation({ summary: '会话存档批量入队（无需手工上传）' })
  ingest(@Body() body: { messages?: ArchiveMessage[] }) {
    return this.archive.enqueue(body.messages ?? []);
  }

  @Post('quality-check')
  quality(@Body() body: { sensitiveHits: number; refusals: number; total: number; p95LatencyMs: number }) {
    return { alerts: this.archive.runQualityChecks(body) };
  }

  @Get('jobs')
  jobs() {
    return { items: this.archive.listJobs() };
  }
}
