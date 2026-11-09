import { Module } from '@nestjs/common';
import { AdminAuthModule } from './admin-auth.module.js';
import { ConfigController } from './config.controller.js';
import { MissController } from './miss.controller.js';
import { LicenseController } from './license.controller.js';
import { StatsController } from './stats.controller.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';
import { UsersController } from './users.controller.js';
import { AuditLogsController } from './audit-logs.controller.js';
import { MissModule } from '../miss/miss.module.js';
import { LicenseModule } from '../license/license.module.js';
import { RoutingModule } from '../routing/routing.module.js';
import { UsageModule } from '../usage/usage.module.js';

@Module({
  imports: [AdminAuthModule, MissModule, LicenseModule, RoutingModule, UsageModule],
  controllers: [
    ConfigController,
    MissController,
    LicenseController,
    StatsController,
    KnowledgeController,
    UsersController,
    AuditLogsController,
  ],
  providers: [KnowledgeService],
  exports: [AdminAuthModule, KnowledgeService],
})
export class AdminModule {}
