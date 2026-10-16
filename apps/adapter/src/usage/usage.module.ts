/**
 * Usage module - counters, snapshots, and webhook reporting
 */
import { Module, Global } from '@nestjs/common';
import { UsageService } from './usage.service.js';
import { UsageWebhookService } from './usage-webhook.service.js';
import { UsageReporterScheduler } from './usage-reporter.scheduler.js';

@Global()
@Module({
  providers: [UsageService, UsageWebhookService, UsageReporterScheduler],
  exports: [UsageService, UsageWebhookService],
})
export class UsageModule {}