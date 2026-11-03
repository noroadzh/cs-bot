/** /admin/knowledge/* — FastGPT 知识代理 */
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from './admin.guard.js';
import { KnowledgeService } from './knowledge.service.js';
import { MissService } from '../miss/miss.service.js';

@Controller('admin/knowledge')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly miss: MissService,
  ) {}

  @Get('collections')
  @ApiOperation({ summary: '代理列出数据集 collection 计数' })
  list() {
    return this.knowledge.listCollections();
  }

  @Get('search')
  @ApiOperation({ summary: '代理检索调试' })
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.knowledge.search(q ?? '', Number(limit ?? 5) || 5);
  }

  @Post('ingest')
  @ApiOperation({ summary: '一键补录：写入 FastGPT，并可标记 miss status=1' })
  async ingest(
    @Body()
    body: {
      question: string;
      answer: string;
      missId?: number;
      datasetName?: string;
    },
  ) {
    const result = await this.knowledge.ingestQa(
      [{ question: body.question, answer: body.answer }],
      body.datasetName,
    );
    if (body.missId != null) {
      await this.miss.updateStatus(body.missId, 1);
    }
    return result;
  }
}
