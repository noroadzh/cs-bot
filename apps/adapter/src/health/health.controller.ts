/** GET /healthz */
import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Redis } from 'ioredis';
import { Client as PgClient } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { LicenseService } from '../license/license.service.js';

@Controller()
export class HealthController {
  private readonly cfg = ConfigService.instance;

  constructor(private readonly license: LicenseService) {}

  @Get('healthz')
  async check() {
    const deps: string[] = [];
    try {
      const r = new Redis({ host: this.cfg.REDIS_HOST, port: this.cfg.REDIS_PORT, password: this.cfg.REDIS_PASSWORD || undefined, lazyConnect: true, connectTimeout: 2000 });
      await r.ping();
      r.disconnect();
    } catch { deps.push('redis'); }
    try {
      const pg = new PgClient({ connectionString: this.cfg.DATABASE_URL, connectionTimeoutMillis: 2000 });
      await pg.connect();
      await pg.query('SELECT 1');
      await pg.end();
    } catch { deps.push('postgresql'); }
    const licenseState = await this.license.verifyAndCache();
    if (!licenseState.valid) deps.push('license');
    if (deps.length > 0) {
      throw new HttpException({ status: 'degraded', deps, license: licenseState }, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return { status: 'ok', license: { valid: licenseState.valid, mock: licenseState.mock } };
  }
}
