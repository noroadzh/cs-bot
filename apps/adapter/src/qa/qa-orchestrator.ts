/** QaOrchestrator */
import { Injectable, Inject } from '@nestjs/common';
import { IQA_ENGINE, type IQAEngine, ErrCode } from '@cs-bot/shared';
import { ContextService } from '../context/context.service.js';
import { SensitiveFilterService } from '../filter/sensitive-filter.service.js';
import { LlmAlertService } from './llm-alert.service.js';
import { MissService } from '../miss/miss.service.js';
import { AssetSenderService } from '../media/asset-sender.service.js';
import { AssetReferenceResolver } from '../media/asset-reference.resolver.js';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { hashId } from '../common/request-context.js';
import { UsageService } from '../usage/usage.service.js';
import { isUnusableQuestion, loadTriggerPrefixes, normalizeQuestion } from './question-normalizer.js';
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
    private readonly llmAlert: LlmAlertService = new LlmAlertService(),
  ) {}

  async handle(msg: InboundMsg, traceId: string, _triggerReason: 'mention' | 'keyword'): Promise<void> {
    const chatId = msg.ChatId ?? msg.FromUserName;
    const userId = msg.FromUserName;
    const question = normalizeQuestion(
      msg.text ?? msg.Content ?? '',
      loadTriggerPrefixes(this.cfg.KEYWORDS_FILE),
    );
    if (isUnusableQuestion(question)) {
      this.logger.log({ detail: 'question-guarded', chatHash: hashId(chatId), length: question.length });
      try {
        await this.sender.sendText(chatId, this.cfg.QUESTION_GUIDANCE_TEXT, msg.mentioned ? userId : undefined);
      } catch (err) {
        this.logger.warn({ traceId, detail: 'guidance-send-fail', err: (err as Error).message });
      }
      return;
    }
    this.logger.log({ detail: 'qa-start', chatHash: hashId(chatId), userHash: hashId(userId), trigger: _triggerReason });
    const history = await this.context.get(chatId, userId);
    const engineStart = Date.now();
    // 所有模式都走 FastGPT（保留 RAG）；local 档由引擎禁止云回退
    const result = await this.engine.ask({
      question,
      history,
      traceId,
      chatId: `group:${chatId}:${userId}`,
    });
    if (result.ok && result.value.source === 'fallback') {
      this.usageService.increment('llmFailovers');
      this.logger.warn({ detail: 'model-failover', source: result.value.source });
    }
    this.logger.timing(
      {
        detail: 'engine',
        engine: this.engine.mode,
        ok: result.ok,
        score: result.ok ? result.value.score : undefined,
      },
      Date.now() - engineStart,
    );

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
      // LLM 调用失败同样属于未应答，计入 messagesMissed；同时记录 LLM 失败率
      this.usageService.increment('messagesMissed');
      this.usageService.increment('llmFailures');
      // 双通道失败告警（旁路，节流；失败不影响回复）
      void this.llmAlert.recordFailure(describeErr((result as { error?: unknown }).error)).catch(() => undefined);
    } else {
      score = result.value.score;
      if (score < this.cfg.CONFIDENCE_THRESHOLD) {
        await this.miss.record({ traceId, chatId, userId, question, score, engine: this.engine.mode, ts: new Date().toISOString() });
        answer = this.cfg.REFUSAL_TEXT;
        this.usageService.increment('messagesMissed');
      } else {
        answer = result.value.answer + this.formatCitations(result.value.quotes);
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
        await this.sender.sendText(chatId, segments[i], msg.mentioned ? userId : undefined, `${traceId}:${i}`);
        if (i < segments.length - 1) await this.sleep(this.cfg.SEGMENT_GAP_MS);
      }
      this.logger.log({ detail: 'sent', chatHash: hashId(chatId), segments: segments.length, answered });
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

  /** 来源引用：最多 2 条，格式 —— 来源：《文档名》 */
  private formatCitations(quotes?: Array<{ source?: string; title?: string }>): string {
    const names = [
      ...new Set(
        (quotes ?? [])
          .map((q) => q.source ?? q.title)
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0),
      ),
    ].slice(0, 2);
    if (names.length === 0) return '';
    return '\n' + names.map((n) => `—— 来源：《${n}》`).join('\n');
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

/** 归一化 Result 错误（可能是 ErrCode 数值或 {code,message}）为可读原因 */
function describeErr(error: unknown): string {
  if (error === null || error === undefined) return 'llm-failure';
  if (typeof error === 'string') return error;
  if (typeof error === 'number') return String(error);
  const obj = error as { code?: unknown; message?: unknown };
  if (obj.code !== undefined) return String(obj.code);
  if (obj.message !== undefined) return String(obj.message);
  return 'llm-failure';
}
