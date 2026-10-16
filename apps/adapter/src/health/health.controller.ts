/** GET /healthz */
import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Redis } from 'ioredis';
import type { Client as PgClient } from 'pg';
import { LicenseService } from '../license/license.service.js';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly license: LicenseService,
    @Inject('HEALTH_REDIS') private readonly healthRedis: Redis,
    @Inject('HEALTH_PG') private readonly healthPg: PgClient,
  ) {}

  @Get('healthz')
  @ApiOperation({ summary: '健康检查' })
  @ApiResponse({ status: 200, description: '所有依赖正常' })
  @ApiResponse({ status: 503, description: '服务降级，部分依赖不可用' })
  async check() {
    const deps: string[] = [];
    try {
      await this.healthRedis.ping();
    } catch { deps.push('redis'); }
    try {
      await this.healthPg.query('SELECT 1');
    } catch { deps.push('postgresql'); }
    const licenseState = await this.license.verifyAndCache();
    if (!licenseState.valid) deps.push('license');
    if (deps.length > 0) {
      throw new HttpException({ status: 'degraded', deps, license: licenseState }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', license: { valid: licenseState.valid, mock: licenseState.mock } };
  }
}
