import { Controller, Get, HttpException, HttpStatus, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { ConfigService } from '../config/config.service.js';

@Controller()
export class ControlPlaneHealthController implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: ConfigService.instance.DATABASE_URL, max: 2 });
  }

  @Get('healthz')
  async check() {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ok', service: 'control-plane' };
    } catch (err) {
      throw new HttpException(
        { status: 'degraded', deps: ['postgresql'], error: (err as Error).message },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}
