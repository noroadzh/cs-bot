/** /platform/users — control-plane mirror of admin users API */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminGuard } from '../admin/admin.guard.js';
import { RolesGuard } from '../admin/roles.guard.js';
import { Roles } from '../admin/roles.decorator.js';
import { AdminIdentityService } from '../admin/admin-identity.service.js';
import type { AdminRole } from '../admin/admin-roles.js';
import { PlatformEnabledGuard } from './platform.controller.js';

@Controller('platform/users')
@ApiTags('platform')
@UseGuards(PlatformEnabledGuard, AdminGuard, RolesGuard)
@Roles('admin')
export class PlatformUsersController {
  constructor(private readonly identity: AdminIdentityService) {}

  @Get()
  @ApiOperation({ summary: '列出控制面管理用户' })
  async list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.identity.listUsers({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '创建控制面管理用户' })
  async create(@Body() body: { username?: string; password?: string; roleCode?: AdminRole }) {
    return this.identity.createUser({
      username: body.username ?? '',
      password: body.password ?? '',
      roleCode: (body.roleCode ?? 'operator') as AdminRole,
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新控制面管理用户' })
  async update(
    @Param('id') id: string,
    @Body() body: { password?: string; roleCode?: AdminRole; enabled?: boolean },
  ) {
    return this.identity.updateUser(id, body);
  }

  @Post(':id/disable')
  @ApiOperation({ summary: '禁用控制面管理用户' })
  async disable(@Param('id') id: string) {
    return this.identity.disableUser(id);
  }
}
