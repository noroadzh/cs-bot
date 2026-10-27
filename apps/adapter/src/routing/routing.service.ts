/** RoutingService */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { TriggerService } from './trigger.service.js';
import { DedupService } from './dedup.service.js';
import { RateLimiterService } from './rate-limiter.service.js';
import { QaOrchestrator } from '../qa/qa-orchestrator.js';
import { UsageService } from '../usage/usage.service.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';
import type { InboundMsg } from '../wecom/wecom-crypto.js';
import { ConfigService } from '../config/config.service.js';
import { IMessageSender } from '../qa/message-sender.port.js';

@Injectable()
export class RoutingService {
  private readonly logger = new AppLogger('RoutingService');
  private readonly cfg = ConfigService.instance;

  constructor(
    private readonly trigger: TriggerService,
    private readonly dedup: DedupService,
    private readonly rateLimiter: RateLimiterService,
    private readonly qaOrchestrator: QaOrchestrator,
    private readonly usageService: UsageService,
    @Optional() @Inject(IMessageSender) private readonly sender?: IMessageSender,
  ) {}

  async dispatch(msg: InboundMsg, traceId: string): Promise<void> {
    // 群白名单：未配置则不限制；配置后非白名单群完全静默且不落库
    const allowed = (this.cfg.ALLOWED_CHAT_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.length > 0) {
      const key = msg.ChatId ?? msg.FromUserName ?? '';
      if (!key || !allowed.includes(key)) {
        this.logger.log({ traceId, detail: 'chat-not-allowed', chatHash: key.slice(0, 6) });
        return;
      }
    }

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
        await this.sendRateHint(msg.ChatId, rate.scope);
        return;
      }
    }
    await this.qaOrchestrator.handle(msg, traceId, trig.reason);
  }

  /** 限流提示：单人立即提示；群提示按 5 分钟去重 */
  private async sendRateHint(chatId: string, scope?: 'group' | 'user'): Promise<void> {
    if (!this.sender || !chatId) return;
    try {
      if (scope === 'group') {
        const should = typeof this.rateLimiter.shouldHint === 'function'
          ? await this.rateLimiter.shouldHint(chatId)
          : true;
        if (!should) return;
      }
      await this.sender.sendText(chatId, this.cfg.RATE_HINT_TEXT ?? '提问太频繁，请稍后再试');
    } catch (err) {
      this.logger.warn({ detail: 'rate-hint-fail', err: (err as Error).message });
    }
  }
}
