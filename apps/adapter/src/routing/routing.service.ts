/** RoutingService */
import { Injectable } from '@nestjs/common';
import { TriggerService } from './trigger.service.js';
import { DedupService } from './dedup.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { QaOrchestrator } from '../qa/qa-orchestrator.js';
import { UsageService } from '../usage/usage.service.js';
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
    private readonly usageService: UsageService,
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
    // D10: 命中触发器即计一次，与后续 dedup→rate-limit→orchestrator 的成败无关。
    // 放在这里是因为再往前会被 dedup 挡掉（重复推送不该算触发命中）。
    this.usageService.increment('messagesTriggered');
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
