/** GET /admin/license · POST /admin/license/reload */
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { LicenseService } from '../license/license.service.js';

@Controller('admin')
@UseGuards(AdminGuard)
export class LicenseController {
  constructor(private readonly license: LicenseService) {}

  @Get('license')
  status() { return this.license.verifyAndCache(); }

  @Post('license/reload')
  reload() { return this.license.reload(); }
}
