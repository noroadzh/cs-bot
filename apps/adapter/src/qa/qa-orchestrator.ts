/** QaOrchestrator */
import { Injectable, Inject } from '@nestjs/common';
import { IQA_ENGINE, type IQAEngine, Ok, Err, ErrCode, type AskResult } from '@cs-bot/shared';
import { ModelRouter } from './model-router.js';
import { ContextService } from '../context/context.service.js';
import { SensitiveFilterService } from '../filter/sensitive-filter.service.js';
import { MissService } from '../miss/miss.service.js';
import { AssetSenderService } from '../media/asset-sender.service.js';
import { AssetReferenceResolver } from '../media/asset-reference.resolver.js';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { UsageService } from '../usage/usage.service.js';
import type { InboundMsg } from '../wecom/wecom-crypto.js';
import { IMessageSender } from './message-sender.port.js';

const ASSET_RE = /\[\[素材:([a-f0-9-]+)\]\]/gi;

@Injectable()
export class QaOrchestrator {
  private readonly logger = new AppLogger('QaOrchestrator');
  private readonly cfg = ConfigService.instance;

  constructor(
    @Inject(IQA_ENGINE) private readonly engine: IQAEngine,
    private readonly context: ContextService,
    private readonly filter: SensitiveFilterService,
    private readonly miss: MissService,
    private readonly assetSender: AssetSenderService,
    private readonly assetResolver: AssetReferenceResolver,
    private readonly usageService: UsageService,
    @Inject(IMessageSender) private readonly sender: IMessageSender,
  ) {}

  /** 增项 D：模型通道路由（null = 沿用 IQAEngine，即 cloud/未配置） */
  private modelRouter: ModelRouter | null = null;

  setModelRouter(r: ModelRouter | null): void {
    this.modelRouter = r;
  }

  /** 通过 ModelRouter 直连 LLM（local/hybrid），绕过 RAG；失败按 LLM 超时处理 */
  private async askViaRouter(question: string): Promise<AskResult> {
    try {
      const r = await this.modelRouter!.chat(question);
      if (r.failover) {
        this.usageService.increment('llmFailovers');
        this.logger.warn({ detail: 'model-failover', source: r.source });
      }
      return new Ok({
        answer: r.text,
        score: 1,
        source: r.source === 'local' ? 'primary' : 'fallback',
      });
    } catch (err) {
      this.logger.warn({ detail: 'local-model-failed', err: (err as Error).message });
      return new Err({ code: ErrCode.LLM_TIMEOUT, message: (err as Error).message });
    }
  }

  async handle(msg: InboundMsg, traceId: string, _triggerReason: 'mention' | 'keyword'): Promise<void> {
    const chatId = msg.ChatId ?? msg.FromUserName;
    const userId = msg.FromUserName;
    const question = msg.text ?? msg.Content ?? '';
    const history = await this.context.get(chatId, userId);
    const result =
      this.modelRouter && this.modelRouter.getMode() !== 'cloud'
        ? await this.askViaRouter(question)
        : await this.engine.ask({ question, history, traceId });

    // 12.1 usage: LLM 调用后按引擎模式与来源计 token 桶
    if (this.engine.mode !== 'mock') {
      const source = result.ok ? result.value.source ?? 'primary' : ('primary' as const);
      const bucket = source === 'fallback' ? 'tokensFallback' : 'tokensPrimary';
      const tokens = result.ok ? ((result.value as any).tokens ?? 0) : 0;
      // 仅当引擎返回有效 tokens 时计费；无 tokens 说明无法计量，不按 1 次兜底
      if (tokens > 0) {
        this.usageService.increment(bucket, tokens);
      }
    }

    let answer: string;
    let score = 0;
    let answered = false;
    if (!result.ok) {
      answer = this.cfg.SLOW_REPLY_TEXT;
      this.logger.warn({ traceId, errCode: ErrCode.LLM_TIMEOUT });
      // LLM 调用失败同样属于未应答，计入 messagesMissed
      this.usageService.increment('messagesMissed');
    } else {
      score = result.value.score;
      if (score < this.cfg.CONFIDENCE_THRESHOLD) {
        await this.miss.record({ traceId, chatId, userId, question, score, engine: this.engine.mode, ts: new Date().toISOString() });
        answer = this.cfg.REFUSAL_TEXT;
        this.usageService.increment('messagesMissed');
      } else {
        answer = result.value.answer;
        answered = true;
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
        await this.sender.sendText(chatId, segments[i], msg.mentioned ? userId : undefined);
        if (i < segments.length - 1) await this.sleep(this.cfg.SEGMENT_GAP_MS);
      }
      // 发送成功后才计 answered；refused 文本已发送也归入 refused
      if (answered) {
        this.usageService.increment('messagesAnswered');
      } else if (score < this.cfg.CONFIDENCE_THRESHOLD) {
        this.usageService.increment('messagesRefused');
      }
      for (const assetId of assetIds) {
        const asset = await this.assetResolver.resolveReference(assetId);
        if (!asset) {
          this.logger.warn({ traceId, assetId, detail: 'unresolved-asset-reference' });
          continue;
        }
        await this.assetSender
          .send(chatId, { id: asset.id, type: asset.type })
          .then(() => this.usageService.increment('assetsSent'))
          .catch((err) => {
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
