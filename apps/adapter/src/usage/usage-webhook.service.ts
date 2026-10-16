/**
 * Usage webhook service - reports usage to external endpoint
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { UsageService, UsageSnapshot } from './usage.service.js';
import axios from 'axios';

@Injectable()
export class UsageWebhookService {
  private readonly logger = new Logger(UsageWebhookService.name);
  private readonly WEBHOOK_TIMEOUT_MS = 10000;

  constructor(private readonly usage: UsageService) {
    if (!ConfigService.instance.USAGE_WEBHOOK_URL) {
      this.logger.log({ phase: 'ready', detail: 'usage webhook disabled' });
    }
  }

  /**
   * Report usage to webhook endpoint
   */
  async report(): Promise<boolean> {
    const url = ConfigService.instance.USAGE_WEBHOOK_URL;
    if (!url) {
      this.logger.debug({ phase: 'skip', detail: 'no webhook URL configured' });
      return false;
    }

    const snapshot = this.usage.getUsage();

    try {
      await axios.post(url, snapshot, {
        timeout: this.WEBHOOK_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });

      this.logger.log({
        phase: 'report',
        detail: 'usage reported',
        url: url.replace(/\/.*$/, '/***'), // mask path
        period: snapshot.period,
      });

      return true;
    } catch (err) {
      this.logger.error({
        phase: 'error',
        detail: 'usage webhook failed',
        err: (err as Error).message,
      });
      // Non-2xx is logged but not thrown (per spec)
      return false;
    }
  }
}