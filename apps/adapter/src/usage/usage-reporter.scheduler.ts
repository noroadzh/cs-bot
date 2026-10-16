/**
 * Usage reporting scheduler - periodic webhook reports
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '../config/config.service.js';
import { UsageWebhookService } from './usage-webhook.service.js';

@Injectable()
export class UsageReporterScheduler {
  private readonly logger = new Logger(UsageReporterScheduler.name);

  constructor(private readonly webhook: UsageWebhookService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async reportDaily() {
    if (!ConfigService.instance.USAGE_WEBHOOK_URL) return;
    this.logger.log({ phase: 'cron', detail: 'daily usage report' });
    await this.webhook.report();
  }
}