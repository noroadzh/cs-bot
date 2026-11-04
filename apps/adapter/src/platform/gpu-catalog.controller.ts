import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { Roles } from '../admin/roles.decorator.js';
import { RolesGuard } from '../admin/roles.guard.js';
import { ModelRouterService, type ModelEndpoint } from '../qa/model-router.service.js';
import { FinetuneJobService } from './finetune-job.service.js';
import { GpuHealthService } from './gpu-health.service.js';

@Controller('platform/models')
@ApiBearerAuth()
@ApiTags('platform')
@UseGuards(AdminGuard, RolesGuard)
export class GpuCatalogController {
  constructor(
    private readonly router: ModelRouterService,
    private readonly jobs: FinetuneJobService,
    private readonly health: GpuHealthService,
  ) {}

  @Get()
  list() {
    return { items: this.router.list() };
  }

  @Post('register')
  @Roles('admin')
  @ApiOperation({ summary: '注册 vLLM / LoRA 产物到模型目录（不进热路径）' })
  register(@Body() body: ModelEndpoint) {
    return this.router.register(body);
  }

  @Post('probe')
  @Roles('admin')
  @ApiOperation({ summary: '立即探测全部 HTTP 端点健康' })
  async probeAll() {
    await this.health.probeAll();
    return { items: this.router.list() };
  }

  @Post('finetune')
  @Roles('admin')
  @ApiOperation({ summary: '创建微调任务（queued，不阻塞热路径）' })
  createJob(@Body() body: { name: string; baseModel?: string }) {
    return this.jobs.create(body);
  }

  @Get('finetune')
  @ApiOperation({ summary: '列出微调任务' })
  listJobs() {
    return this.jobs.list().then((items) => ({ items }));
  }

  @Get('finetune/:id')
  @ApiOperation({ summary: '查询微调任务状态' })
  getJob(@Param('id') id: string) {
    return this.jobs.get(id).then((job) => job ?? { errCode: 'FINETUNE_NOT_FOUND' });
  }

  @Post('finetune/:id/running')
  @Roles('admin')
  markRunning(@Param('id') id: string) {
    return this.jobs.markRunning(id);
  }

  @Post('finetune/complete')
  @Roles('admin')
  @ApiOperation({ summary: '微调任务完成回调：登记 artifact 并更新任务状态' })
  finetuneComplete(
    @Body() body: { id: string; name?: string; artifactUri: string; baseUrl?: string },
  ) {
    return this.jobs.complete(body);
  }
}
