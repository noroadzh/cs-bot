import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LicenseService } from '../license/license.service.js';
import { ConfigService } from '../config/config.service.js';

const HealthRedis = {
  provide: 'HEALTH_REDIS',
  useFactory: () => {
    const cfg = ConfigService.instance;
    const Redis = require('ioredis').Redis;
    return new Redis({ host: cfg.REDIS_HOST, port: cfg.REDIS_PORT, password: cfg.REDIS_PASSWORD || undefined, lazyConnect: true, connectTimeout: 20_000 });
  },
};

const HealthPg = {
  provide: 'HEALTH_PG',
  useFactory: () => {
    const cfg = ConfigService.instance;
    const { Client } = require('pg');
    return new Client({ connectionString: cfg.DATABASE_URL, connectionTimeoutMillis: 20_000 });
  },
};

@Module({
  controllers: [HealthController],
  providers: [LicenseService, HealthRedis, HealthPg],
})
export class HealthModule {}
