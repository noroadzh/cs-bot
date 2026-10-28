/**
 * Usage module - counters, snapshots, and webhook reporting
 */
import { Module, Global } from '@nestjs/common';
import { UsageService } from './usage.service.js';
import { UsageWebhookService } from './usage-webhook.service.js';
import { UsageReporterScheduler } from './usage-reporter.scheduler.js';
import { CapacityUsageService } from './capacity-usage.service.js';

@Global()
@Module({
  providers: [UsageService, UsageWebhookService, CapacityUsageService, UsageReporterScheduler],
  exports: [UsageService, UsageWebhookService],
})
export class UsageModule {}