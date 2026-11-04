import { Controller, Get, HttpException, HttpStatus, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ConfigService } from '../config/config.service.js';
import { buildTrustedProxies, normalizeIp, resolveClientIp } from '../common/client-ip.js';
import { MetricsService } from './metrics.service.js';

@ApiTags('health')
@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Prometheus metrics（METRICS_ENABLED）' })
  scrape(@Req() req: Request): string {
    if (!this.metrics.enabled()) {
      throw new HttpException({ errCode: 'METRICS_DISABLED' }, HttpStatus.NOT_FOUND);
    }
    const allow = ConfigService.instance.METRICS_ALLOW_CIDRS || '';
    if (allow.trim()) {
      const ip = resolveClientIp(req);
      const n = normalizeIp(ip);
      if (!n || !buildTrustedProxies(allow).check(n.address, n.family)) {
        throw new HttpException({ errCode: 'METRICS_FORBIDDEN' }, HttpStatus.FORBIDDEN);
      }
    }
    return this.metrics.render();
  }
}
