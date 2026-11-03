import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard.js';
import { RolesGuard } from './roles.guard.js';
import { ConfigController } from './config.controller.js';
import { MissController } from './miss.controller.js';
import { LicenseController } from './license.controller.js';
import { StatsController } from './stats.controller.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { MissModule } from '../miss/miss.module.js';
import { LicenseModule } from '../license/license.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { UsageModule } from '../usage/usage.module.js';

@Module({
  imports: [MissModule, LicenseModule, RoutingModule, UsageModule],
  controllers: [
    ConfigController,
    MissController,
    LicenseController,
    StatsController,
    KnowledgeController,
  ],
  providers: [AdminGuard, RolesGuard, KnowledgeService],
  exports: [AdminGuard, RolesGuard, KnowledgeService],
})
export class AdminModule {}
