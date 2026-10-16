/**
 * Asset Controller
 * Admin endpoints for media asset management
 */
import {
  Controller, Get, Post, Delete, Body, Param, Query,
  UseGuards, HttpException, HttpStatus, Req, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AdminGuard } from '../admin/admin.guard.js';
import { AssetService } from './asset.service.js';
import type { Asset, AssetListQuery } from './asset.entity.js';

/** 解析分页参数：字符串→正整数，无效或非正数返回 undefined */
function toPositiveInt(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return isNaN(n) || n <= 0 ? undefined : n;
}

@Controller('admin/assets')
@ApiBearerAuth()
@ApiTags('admin')
@UseGuards(AdminGuard)
export class AssetController {
  constructor(private readonly assetService: AssetService) {}

  /**
   * POST /admin/assets
   * Upload a new asset (multipart) or create from URL (JSON)
   */
  @Post()
  @ApiOperation({ summary: '创建素材（multipart 上传或 JSON url+name）' })
  @ApiResponse({ status: 201, description: '创建成功，返回素材记录' })
  @ApiResponse({ status: 400, description: '缺少文件或缺少 url/name 字段' })
  @ApiResponse({ status: 401, description: 'Basic Auth 认证失败' })
  async create(@Req() req: Request) {
    const contentType = req.headers['content-type'] ?? '';

    // Handle multipart file upload
    if (contentType.includes('multipart/form-data')) {
      const file = (req as any).file;
      if (!file) {
        throw new HttpException({ errCode: 'NO_FILE' }, HttpStatus.BAD_REQUEST);
      }

      const asset = await this.assetService.createFromFile(
        file.buffer,
        file.originalname,
        file.mimetype,
      );
      return { success: true, asset };
    }

    // Handle JSON body (URL-based asset)
    const body = req.body as { url?: string; name?: string };
    if (!body.url || !body.name) {
      throw new HttpException(
        { errCode: 'MISSING_REQUIRED_FIELDS', detail: 'url and name required' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const asset = await this.assetService.createFromLink(body.url, body.name);
    return { success: true, asset };
  }

  /**
   * GET /admin/assets
   * List assets with pagination
   */
  @Get()
  @ApiOperation({ summary: '分页列出素材' })
  @ApiResponse({ status: 200, description: '返回 total/limit/offset/assets' })
  @ApiResponse({ status: 401, description: 'Basic Auth 认证失败' })
  async list(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const query: AssetListQuery = {
      limit: toPositiveInt(limit),
      offset: toPositiveInt(offset),
    };

    const result = await this.assetService.findAll(query);
    return {
      success: true,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      assets: result.rows,
    };
  }

  /**
   * GET /admin/assets/:id
   * Get asset by ID
   */
  @Get(':id')
  @ApiOperation({ summary: '按 id 查询素材' })
  @ApiResponse({ status: 200, description: '返回素材' })
  @ApiResponse({ status: 404, description: 'ASSET_NOT_FOUND' })
  @ApiResponse({ status: 401, description: 'Basic Auth 认证失败' })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const asset = await this.assetService.findById(id);
    if (!asset) {
      throw new HttpException({ errCode: 'ASSET_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }
    return { success: true, asset };
  }

  /**
   * DELETE /admin/assets/:id
   * Delete asset by ID
   */
  @Delete(':id')
  @ApiOperation({ summary: '按 id 删除素材' })
  @ApiResponse({ status: 200, description: '删除成功' })
  @ApiResponse({ status: 404, description: 'ASSET_NOT_FOUND' })
  @ApiResponse({ status: 401, description: 'Basic Auth 认证失败' })
  async delete(@Param('id', ParseUUIDPipe) id: string) {
    const deleted = await this.assetService.delete(id);
    if (!deleted) {
      throw new HttpException({ errCode: 'ASSET_NOT_FOUND' }, HttpStatus.NOT_FOUND);
    }
    return { success: true, deleted: true };
  }
}