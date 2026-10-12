/** RoutingService */
import { Injectable } from '@nestjs/common';
import { TriggerService } from './trigger.service.js';
import { DedupService } from './dedup.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { QaOrchestrator } from '../qa/qa-orchestrator.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';
import type { InboundMsg } from '../wecom/wecom-crypto.js';

@Injectable()
export class RoutingService {
  private readonly logger = new AppLogger('RoutingService');

  constructor(
    private readonly trigger: TriggerService,
    private readonly dedup: DedupService,
    private readonly rateLimiter: RateLimiterService,
    private readonly qaOrchestrator: QaOrchestrator,
  ) {}

  async dispatch(msg: InboundMsg, traceId: string): Promise<void> {
    if (msg.MsgId && (await this.dedup.isDuplicate(msg.MsgId))) {
      this.logger.warn({ traceId, errCode: ErrCode.DEDUP_DUP, msgId: msg.MsgId });
      return;
    }
    const trig = this.trigger.evaluate(msg);
    if (!trig.triggered) {
      this.logger.log({ traceId, errCode: ErrCode.NOT_TRIGGERED, reason: trig.reason });
      return;
    }
    if (msg.ChatId) {
      const rate = await this.rateLimiter.check(msg.ChatId, msg.FromUserName);
      if (!rate.allowed) {
        this.logger.warn({ traceId, errCode: ErrCode.RATE_LIMITED, scope: rate.scope });
        return;
      }
    }
    await this.qaOrchestrator.handle(msg, traceId, trig.reason);
  }
}
