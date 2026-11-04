import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { LearningService } from './learning.service.js';
import { MissExportService } from '../miss/miss-export.service.js';

@Controller('admin/learning')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class LearningController {
  constructor(
    private readonly learning: LearningService,
    private readonly missExport: MissExportService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: '自动学习开关状态' })
  status() {
    return { autoLearningEnabled: this.learning.isAutoLearningEnabled() };
  }

  @Post('cluster')
  @ApiOperation({ summary: '对近期未命中做聚类，生成建议答案并可按开关自动入库' })
  async cluster(@Body() body: { answers?: Record<string, string>; days?: number }) {
    const items = await this.missExport.queryItems(body.days ?? 7);
    const clusters = this.learning.cluster(items.map((i) => i.question));
    return this.learning.suggestAndMaybeIngest(clusters, body.answers ?? {});
  }

  @Get('queue')
  @ApiOperation({ summary: '待人工审核的学习队列（含建议答案）' })
  queue() {
    return { items: this.learning.getQueue() };
  }

  @Post('approve')
  @ApiOperation({ summary: '人工审核通过并入库' })
  async approve(@Body() body: { key: string; answer?: string }) {
    return this.learning.approve({ key: body.key, answer: body.answer });
  }

  @Get('audit')
  @ApiOperation({ summary: '自动学习 / 人工审核审计' })
  async audit(@Query('limit') limit?: string) {
    return { items: await this.learning.getAudit(Number(limit ?? 100) || 100) };
  }
}
