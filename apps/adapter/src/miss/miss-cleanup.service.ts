/** MissCleanupService */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

@Injectable()
export class MissCleanupService implements OnModuleInit {
  private readonly logger = new AppLogger('MissCleanupService');
  private readonly pool: Pool;
  private readonly days: number;
  private lastRunAt: number | null = null;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.pool = new Pool({ connectionString: cfg.DATABASE_URL });
    this.days = cfg.MISS_RECORD_RETENTION_DAYS;
  }

  async onModuleInit(): Promise<void> {
    // R4 mitigation: 若 ScheduleModule 未注册，lastRunAt 保持 null，5 分钟后 warn
    setTimeout(() => {
      if (this.lastRunAt === null) {
        this.logger.warn({ detail: 'schedule-missing', message: 'MissCleanupService.cleanup() has not fired — check that ScheduleModule.forRoot() is present in AppModule' });
      }
    }, 5 * 60 * 1000);
  }

  @Cron('30 3 * * *', { timeZone: 'Asia/Shanghai' })
  async cleanup(): Promise<void> {
    this.lastRunAt = Date.now();
    try {
      const result = await this.pool.query(
        `DELETE FROM miss_record WHERE created_at < now() - interval '${this.days} days'`,
      );
      this.logger.log({ detail: 'cleanup', deletedCount: (result as any).rowCount ?? 0 });
    } catch (err) {
      this.logger.error({ detail: 'cleanup-error', err: (err as Error).message });
    }
  }
}
