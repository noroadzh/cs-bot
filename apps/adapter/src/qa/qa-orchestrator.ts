/** QaOrchestrator */
import { Injectable } from '@nestjs/common';
import { type IQAEngine } from '@cs-bot/shared';
import { ErrCode } from '@cs-bot/shared';
import { ContextService } from '../context/context.service.js';
import { SensitiveFilterService } from '../filter/sensitive-filter.service.js';
import { MissService } from '../miss/miss.service.js';
import { AssetSenderService } from '../media/asset-sender.service.js';
import { WecomClient } from '../wecom/wecom-client.js';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { InboundMsg } from '../wecom/wecom-crypto.js';

const ASSET_RE = /\[\[素材:(\d+)\]\]/g;

@Injectable()
export class QaOrchestrator {
  private readonly logger = new AppLogger('QaOrchestrator');
  private readonly cfg = ConfigService.instance;

  constructor(
    private readonly engine: IQAEngine,
    private readonly context: ContextService,
    private readonly filter: SensitiveFilterService,
    private readonly miss: MissService,
    private readonly assetSender: AssetSenderService,
    private readonly wecomClient: WecomClient,
  ) {}

  async handle(msg: InboundMsg, traceId: string, _triggerReason: 'mention' | 'keyword'): Promise<void> {
    const chatId = msg.ChatId ?? msg.FromUserName;
    const userId = msg.FromUserName;
    const question = msg.text ?? msg.Content ?? '';
    const history = await this.context.get(chatId, userId);
    const result = await this.engine.ask({ question, history, traceId });

    let answer: string;
    let score = 0;
    if (!result.ok) {
      answer = this.cfg.SLOW_REPLY_TEXT;
      this.logger.warn({ traceId, errCode: ErrCode.LLM_TIMEOUT });
    } else {
      score = result.value.score;
      if (score < this.cfg.CONFIDENCE_THRESHOLD) {
        await this.miss.record({ traceId, chatId, userId, question, score, engine: this.engine.mode, ts: new Date().toISOString() });
        answer = this.cfg.REFUSAL_TEXT;
      } else {
        answer = result.value.answer;
      }
    }

    const assetIds: string[] = [];
    answer = answer.replace(ASSET_RE, (_, id) => {
      if (assetIds.length < 2) assetIds.push(id);
      return '';
    });
    answer = this.filter.sweep(answer);
    const segments = this.segmentText(answer);

    try {
      for (let i = 0; i < segments.length; i++) {
        await this.wecomClient.sendText(chatId, segments[i], msg.mentioned ? userId : undefined);
        if (i < segments.length - 1) await this.sleep(this.cfg.SEGMENT_GAP_MS);
      }
      for (const assetId of assetIds) {
        await this.assetSender.send(chatId, { id: assetId, type: 'link' }).catch((err) => {
          this.logger.warn({ traceId, assetId, err: (err as Error).message });
        });
      }
      if (score >= this.cfg.CONFIDENCE_THRESHOLD) {
        await this.context.append(chatId, userId, { question, answer });
      }
    } catch (err) {
      this.logger.error({ traceId, err: (err as Error).message, errCode: ErrCode.WECOM_SEND_FAIL });
    }
  }

  private segmentText(text: string): string[] {
    if (Buffer.byteLength(text, 'utf8') <= this.cfg.SEGMENT_SAFE_BYTES) return [text];
    const boundary = /[。！？!?\n]/g;
    const segments: string[] = [];
    let current = '';
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = boundary.exec(text)) !== null) {
      const chunk = text.slice(lastEnd, m.index + m[0].length);
      if (Buffer.byteLength(current + chunk, 'utf8') > this.cfg.SEGMENT_SAFE_BYTES) {
        if (current) segments.push(current.trim());
        current = chunk;
      } else current += chunk;
      lastEnd = m.index + m[0].length;
    }
    if (current) segments.push(current.trim());
    return segments;
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}
