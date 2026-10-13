import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { ConfigController } from './config.controller.js';
import { MissController } from './miss.controller.js';
import { LicenseController } from './license.controller.js';
import { MissModule } from '../miss/miss.module.js';
import { LicenseModule } from '../license/license.module.js';
import { RoutingModule } from '../routing/routing.module.js';

@Module({
  imports: [MissModule, LicenseModule, RoutingModule],
  controllers: [ConfigController, MissController, LicenseController],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AdminModule {}
