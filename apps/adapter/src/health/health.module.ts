import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LicenseService } from '../license/license.service.js';

@Module({
  controllers: [HealthController],
  providers: [LicenseService],
})
export class HealthModule {}
