import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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
  @ApiOperation({ summary: '对近期未命中做聚类并可选自动入库' })
  async cluster(@Body() body: { answers?: Record<string, string>; days?: number }) {
    const items = await this.missExport.queryItems(body.days ?? 7);
    const clusters = this.learning.cluster(items.map((i) => i.question));
    const result = await this.learning.suggestAndMaybeIngest(clusters, body.answers ?? {});
    return { clusters, ...result };
  }

  @Get('audit')
  audit() {
    return { items: this.learning.getAudit() };
  }
}
