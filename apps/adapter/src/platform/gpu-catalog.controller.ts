import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { Roles } from '../admin/roles.decorator.js';
import { RolesGuard } from '../admin/roles.guard.js';
import { ModelRouterService, type ModelEndpoint } from '../qa/model-router.service.js';

@Controller('platform/models')
@ApiBearerAuth()
@ApiTags('platform')
@UseGuards(AdminGuard, RolesGuard)
export class GpuCatalogController {
  constructor(private readonly router: ModelRouterService) {}

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

  @Post('finetune/complete')
  @Roles('admin')
  @ApiOperation({ summary: '微调任务完成回调：登记 artifact' })
  finetuneComplete(
    @Body() body: { id: string; name: string; artifactUri: string; baseUrl?: string },
  ) {
    return this.router.register({
      id: body.id,
      name: body.name,
      baseUrl: body.baseUrl ?? body.artifactUri,
      kind: 'lora',
      artifactUri: body.artifactUri,
    });
  }
}
