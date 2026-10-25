/**
 * ImportController — M10 REST 端点
 *
 * 端点清单（对应 spec import-job/spec.md §2）：
 *   POST   /admin/import-jobs        创建任务（单文件上传，字段 file，可选 name）
 *   POST   /admin/import-jobs/from-url 远程抓取建任务（body: {url, name?}）
 *   GET    /admin/import-jobs        列表（query: status?, limit?, offset?）
 *   GET    /admin/import-jobs/counts 各状态计数
 *   GET    /admin/import-jobs/:id    job 详情（含 item 审核分布 + 可删标记）
 *   DELETE /admin/import-jobs/:id    删除 job + 级联 items
 *   POST   /admin/import-jobs/:id/parse  触发解析
 *   GET    /admin/import-jobs/:id/items  条目分页（query: reviewStatus?, limit?, offset?）
 *   PATCH  /admin/import-jobs/:id/items/:itemId  逐条审核
 *   POST   /admin/import-jobs/:id/approve-all    批量通过
 *
 * 全部挂 AdminGuard（authenticated + superadmin）。
 */
import {
  Controller, Post, Get, Delete, Patch, Body, Param, Query,
  UseGuards, BadRequestException, HttpStatus, HttpCode, Req, Res,
  UploadedFile, UseInterceptors, NotFoundException, ConflictException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { ImportJobService, type ImportJobCreated } from './import-job.service.js';
import type {
  ImportJobStatus,
  ReviewStatus,
} from './import-job.entity.js';
import { AdminGuard } from '../admin/admin.guard.js';

export interface ImportControllerReq extends Request {
  user?: { id: string; role: string };
}

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/** 分页 limit：默认 50，上限 200 */
function clampLimit(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 50;
}

/** 分页 offset：默认 0 */
function clampOffset(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

@Controller('admin/import-jobs')
@UseGuards(AdminGuard)
export class ImportController {
  constructor(private readonly service: ImportJobService) {}

  // -------------------------------------------------------------------------
  // 创建
  // -------------------------------------------------------------------------

  /** POST /admin/import-jobs — 单文件上传 */
  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: MAX_FILE_BYTES },
  }))
  async createFromFile(
    @Req() req: ImportControllerReq,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('name') name?: string,
  ) {
    if (!file || !file.buffer) {
      throw new BadRequestException({ errCode: 'IMPORT_NO_FILE', detail: 'no file uploaded' });
    }
    return this.toCreatedResponse(
      await this.service.createFromFile({
        filename: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
        name,
      }),
    );
  }

  /** POST /admin/import-jobs/from-url — 远程抓取 */
  @Post('from-url')
  async createFromUrl(
    @Body() body: { url?: string; name?: string },
  ) {
    if (!body.url) {
      throw new BadRequestException({ errCode: 'IMPORT_URL_MISSING', detail: 'url is required' });
    }
    return this.toCreatedResponse(await this.service.createFromUrl(body.url, body.name));
  }

  /**
   * 创建响应投影：只暴露 spec 约定的顶层字段，剥离内部字段
   * （storedPath / mimeType 属内部解析用，泄露 = 任意文件读取面）。
   * 同源短路（reused）按 spec 返回 409 + existingJobId。
   */
  private toCreatedResponse(result: ImportJobCreated): {
    id: string;
    name: string;
    sourceFilename: string;
    status: string;
  } {
    if (result.reused) {
      throw new ConflictException({
        errCode: 'IMPORT_SOURCE_DUPLICATE',
        existingJobId: result.job.id,
        detail: 'same source already imported',
      });
    }
    const { id, name, sourceFilename, status } = result.job;
    return { id, name, sourceFilename, status };
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  /** GET /admin/import-jobs — 分页（limit/offset）+ status 过滤 */
  @Get()
  async listJobs(@Query() q: Record<string, string | undefined>) {
    return this.service.listJobs({
      status: q.status as ImportJobStatus | undefined,
      limit: clampLimit(q.limit),
      offset: clampOffset(q.offset),
    });
  }

  /** GET /admin/import-jobs/counts — 各状态 job 计数 */
  @Get('counts')
  async countJobs() {
    return this.service.countJobsByStatus();
  }

  /** GET /admin/import-jobs/:id — job 详情 */
  @Get(':id')
  async getJobDetail(@Param('id') id: string) {
    const detail = await this.service.getJobDetail(id);
    if (!detail) {
      throw new NotFoundException({
        errCode: 'IMPORT_JOB_NOT_FOUND',
        detail: `import job ${id} not found`,
      });
    }
    return detail;
  }

  /** DELETE /admin/import-jobs/:id — 删除 job + 级联 items */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteJob(@Param('id') id: string) {
    await this.service.deleteJob(id);
  }

  // -------------------------------------------------------------------------
  // 解析
  // -------------------------------------------------------------------------

  /** POST /admin/import-jobs/:id/parse — 触发解析 */
  @HttpCode(HttpStatus.OK)
  @Post(':id/parse')
  async parseJob(@Param('id') id: string) {
    return this.service.parseJob(id);
  }

  // -------------------------------------------------------------------------
  // 条目审核
  // -------------------------------------------------------------------------

  /** GET /admin/import-jobs/:id/items — 条目分页（limit/offset + review_status/sensitive 过滤） */
  @Get(':id/items')
  async listItems(
    @Param('id') jobId: string,
    @Query() q: Record<string, string | undefined>,
  ) {
    const sensitiveRaw = q.sensitive;
    return this.service.listItems(jobId, {
      reviewStatus: (q.review_status ?? q.status) as ReviewStatus | undefined,
      sensitive:
        sensitiveRaw === undefined
          ? undefined
          : sensitiveRaw === 'true' || sensitiveRaw === '1',
      limit: clampLimit(q.limit),
      offset: clampOffset(q.offset),
    });
  }

  /** PATCH /admin/import-jobs/:id/items/:itemId — 逐条审核 */
  @Patch(':id/items/:itemId')
  async reviewItem(
    @Param('id') jobId: string,
    @Param('itemId') itemId: string,
    @Body() body: { reviewStatus: 'pending' | 'approved' | 'rejected' | 'needs-fix'; note?: string },
  ) {
    return this.service.reviewItem(jobId, itemId, {
      reviewStatus: body.reviewStatus,
      note: body.note,
    });
  }

  /** POST /admin/import-jobs/:id/approve-all — 批量通过 */
  @HttpCode(HttpStatus.OK)
  @Post(':id/approve-all')
  async approveAll(@Param('id') id: string) {
    return this.service.approveAll(id);
  }

  /** GET /admin/import-jobs/:id/review.xlsx — 审核清单（脱敏，30 天保留） */
  @Get(':id/review.xlsx')
  async reviewManifest(@Param('id') id: string, @Res() res: Response) {
    const buf = await this.service.buildManifest(id);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="review-${id}.xlsx"`);
    res.send(buf);
  }

  /** POST /admin/import-jobs/:id/confirm — 提交审核结果并写入 FastGPT 数据集 */
  @HttpCode(HttpStatus.OK)
  @Post(':id/confirm')
  async confirm(
    @Param('id') id: string,
    @Body() body: { decisions?: { itemId: string; reviewStatus: 'approved' | 'rejected' }[] },
  ) {
    return this.service.confirm(id, body.decisions ?? []);
  }

  /** POST /admin/import-jobs/:id/rollback — 批次下线（删除数据集） */
  @HttpCode(HttpStatus.OK)
  @Post(':id/rollback')
  async rollback(@Param('id') id: string) {
    return this.service.rollback(id);
  }

  /** POST /admin/import-jobs/:id/retry — 仅重试失败写入 */
  @HttpCode(HttpStatus.OK)
  @Post(':id/retry')
  async retry(@Param('id') id: string) {
    return this.service.retry(id);
  }
}
