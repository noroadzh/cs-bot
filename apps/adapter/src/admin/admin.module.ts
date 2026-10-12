import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { ConfigController } from './config.controller.js';
import { MissController } from './miss.controller.js';
import { LicenseController } from './license.controller.js';
import { TriggerService } from '../routing/trigger.service.js';
import { LicenseService } from '../license/license.service.js';
import { MissExportService } from '../miss/miss-export.service.js';

@Module({
  controllers: [ConfigController, MissController, LicenseController],
  providers: [AdminGuard, TriggerService, LicenseService, MissExportService],
  exports: [AdminGuard],
})
export class AdminModule {}
