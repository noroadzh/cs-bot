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
  UseGuards, BadRequestException, HttpStatus, HttpCode, Req,
  UploadedFile, UseInterceptors, NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ImportJobService } from './import-job.service.js';
import type {
  ImportJobListQuery,
  ImportItemListQuery,
  ImportJobStatus,
  ReviewStatus,
} from './import-job.entity.js';
import { AdminGuard } from '../admin/admin.guard.js';

export interface ImportControllerReq extends Request {
  user?: { id: string; role: string };
}

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

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
    return this.service.createFromFile({
      filename: file.originalname,
      mimeType: file.mimetype,
      bytes: file.buffer,
      name,
    });
  }

  /** POST /admin/import-jobs/from-url — 远程抓取 */
  @Post('from-url')
  async createFromUrl(
    @Body() body: { url?: string; name?: string },
  ) {
    if (!body.url) {
      throw new BadRequestException({ errCode: 'IMPORT_URL_MISSING', detail: 'url is required' });
    }
    return this.service.createFromUrl(body.url, body.name);
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  /** GET /admin/import-jobs — 分页 + 状态过滤 */
  @Get()
  async listJobs(@Query() q: ImportJobListQuery) {
    const { page = 1, pageSize = 50, status, ...rest } = q;
    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Number(page) || 1) > 0 ? (Number(page) - 1) * limit : 0;
    const result = await this.service.listJobs({
      status: status as ImportJobStatus | undefined,
      limit,
      offset,
    });
    return result;
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

  /** GET /admin/import-jobs/:id/items — 条目分页 */
  @Get(':id/items')
  async listItems(
    @Param('id') jobId: string,
    @Query() q: ImportItemListQuery,
  ) {
    const { page = 1, pageSize = 50, status, ...rest } = q;
    const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200);
    const offset = (Number(page) || 1) > 0 ? (Number(page) - 1) * limit : 0;
    return this.service.listItems(jobId, {
      reviewStatus: status as ReviewStatus | undefined,
      limit,
      offset,
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
}
