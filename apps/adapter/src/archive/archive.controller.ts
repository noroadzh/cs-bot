import { Body, Controller, Get, Headers, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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

  @Post('pull')
  @ApiOperation({ summary: '手动触发存档 SDK 拉取' })
  pull() {
    return this.archive.pullOnce();
  }

  @Get('pull-state')
  @ApiOperation({ summary: '存档拉取 cursor / 错误状态' })
  pullState() {
    return this.archive.pullState();
  }

  @Post('callback')
  @ApiOperation({ summary: '企微存档回调入队（验签）' })
  callback(
    @Req() req: Request,
    @Body() body: { messages?: ArchiveMessage[] },
    @Headers('x-archive-signature') signature?: string,
  ) {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(body ?? {});
    return this.archive.ingestCallback(body.messages ?? [], raw, signature);
  }

  @Post('quality-check')
  @ApiOperation({ summary: '提交质检采样（持久化 + 可选告警）' })
  quality(
    @Body()
    body: {
      sensitiveHits: number;
      refusals: number;
      total: number;
      p95LatencyMs: number;
      windowLabel?: string;
    },
  ) {
    return this.archive.runQualityChecks(body);
  }

  @Get('quality-inspections')
  @ApiOperation({ summary: '质检历史（无会话原文）' })
  inspections(
    @Query('limit') limit?: string,
    @Query('rule') rule?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.archive
      .listInspections({
        limit: limit ? Number(limit) : undefined,
        rule,
        from,
        to,
      })
      .then((items) => ({ items }));
  }

  @Get('jobs')
  jobs() {
    return { items: this.archive.listJobs() };
  }
}
