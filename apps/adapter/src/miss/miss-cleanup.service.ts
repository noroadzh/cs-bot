/** MissCleanupService */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

@Injectable()
export class MissCleanupService {
  private readonly logger = new AppLogger('MissCleanupService');
  private readonly pool: Pool;
  private readonly days: number;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL });
    this.days = cfg.MISS_RECORD_RETENTION_DAYS;
  }

  @Cron('30 3 * * *')
  async cleanup() {
    try {
      const result = await this.pool.query(
        `DELETE FROM miss_record WHERE created_at < now() - interval '${this.days} days'`,
      );
      this.logger.log({ detail: 'cleanup', deleted: (result as any).rowCount });
    } catch (err) {
      this.logger.error({ detail: 'cleanup-error', err: (err as Error).message });
    }
  }
}
