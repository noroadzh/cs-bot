/** FastGPTQaEngine */
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { Err, Ok, ErrCode, type IQAEngine, type AskReq, type AskResult } from '@cs-bot/shared';
import { ApprovedQaService } from './approved-qa.service.js';
import { llmSemaphore } from '../common/semaphore.js';

export class FastGPTQaEngine implements IQAEngine {
  readonly mode: 'fastgpt' = 'fastgpt';
  private readonly primary: AxiosInstance;
  private readonly fallback: AxiosInstance | null;
  private readonly logger = new AppLogger('FastGPTQaEngine');
  private readonly cfg = ConfigService.instance;
  private readonly approvedQa: ApprovedQaService;
  /** cloud：允许低分/失败切云；hybrid：仅失败切云；local：禁止云回退 */
  private readonly allowCloudFallback: boolean;
  private readonly fallbackOnLowScore: boolean;

  constructor(_config: ConfigService, approvedQaService?: ApprovedQaService) {
    this.primary = axios.create({
      baseURL: this.cfg.FASTGPT_BASE_URL,
      timeout: this.cfg.LLM_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${this.cfg.FASTGPT_API_KEY}` },
    });
    this.allowCloudFallback = this.cfg.MODEL_MODE !== 'local';
    this.fallbackOnLowScore = this.cfg.MODEL_MODE === 'cloud';
    // Fallback LLM (LLM_FALLBACK_*): 当 primary 抛错时尝试一次。env 未配则不启用；local 档禁用。
    const fbBase = this.allowCloudFallback ? this.cfg.LLM_FALLBACK_BASE_URL : '';
    const fbKey = this.cfg.LLM_FALLBACK_API_KEY;
    if (fbBase && fbKey) {
      this.fallback = axios.create({
        baseURL: fbBase,
        timeout: this.cfg.LLM_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${fbKey}` },
      });
    } else {
      this.fallback = null;
    }
    // approved_qa fallback: FastGPT 检索无结果时查询本地已审核 QA
    this.approvedQa = approvedQaService ?? new ApprovedQaService();
  }

  async ask(req: AskReq): Promise<AskResult> {
    // 优先级 1: approved_qa（已审核 QA 始终优先于 LLM）
    const approved = await this.approvedQa.search(req.question);
    if (approved) {
      this.logger.log({ detail: 'approved-qa-hit', question: req.question.slice(0, 50) });
      return new Ok({ answer: approved.answer, quotes: [], score: 1.0, source: 'approved' });
    }

    // 优先级 2: primary LLM
    const primaryResp = await this.call(this.primary, req, 'primary');
    if (primaryResp.ok && primaryResp.value.score >= this.cfg.CONFIDENCE_THRESHOLD) {
      return primaryResp;
    }

    // 优先级 3: fallback LLM（local 档没有；hybrid 仅失败时；cloud 低分也可）
    if (this.fallback && (this.fallbackOnLowScore || !primaryResp.ok)) {
      const fallbackResp = await this.call(this.fallback, req, 'fallback');
      if (fallbackResp.ok && fallbackResp.value.score >= this.cfg.CONFIDENCE_THRESHOLD) {
        return fallbackResp;
      }
    }

    // 兜底：返回任何可用的 LLM 结果（即使是低分）
    if (primaryResp.ok) return primaryResp;
    if (this.fallback) {
      const fallbackResp = await this.call(this.fallback, req, 'fallback');
      if (fallbackResp.ok) return fallbackResp;
    }
    return primaryResp;
  }

  private async call(client: AxiosInstance, req: AskReq, source: 'primary' | 'fallback'): Promise<AskResult> {
    let lastErr: Error | null = null;
    const retryDelay = this.cfg.LLM_RETRY_DELAY_MS ?? 1000;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await llmSemaphore().run(() => client.post('/api/v1/chat/completions', {
          model: 'fastgpt',
          chatId: req.chatId,
          stream: false,
          detail: true,
          messages: [{ role: 'user', content: req.question }],
          histories: (req.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          datasetIds: (req.datasetIds ?? (this.cfg.FASTGPT_DATASET_IDS ? [this.cfg.FASTGPT_DATASET_IDS] : [])),
        }));
        return { ok: true, value: this.parseResponse(resp.data, source) };
      } catch (err) {
        lastErr = err as Error;
        this.logger.warn({ source, attempt: attempt + 1, err: lastErr.message });
        if (attempt === 0) await new Promise((r) => setTimeout(r, retryDelay));
      }
    }
    return new Err({ code: ErrCode.LLM_TIMEOUT, message: lastErr?.message ?? 'unknown LLM error' });
  }

  /** 解析 choices/data 与 responseData[].quoteList（来源引用） */
  private parseResponse(raw: unknown, source: 'primary' | 'fallback') {
    const data = raw as {
      choices?: Array<{ message?: { content?: string } }>;
      data?: Array<{ score?: number; content?: string }>;
      responseData?: Array<{
        quoteList?: Array<{
          id?: string; content?: string; score?: number;
          source?: string; datasetName?: string; title?: string;
        }>;
      }>;
    };
    const quotes = (data?.responseData ?? [])
      .flatMap((m) => (Array.isArray(m?.quoteList) ? m.quoteList : []))
      .map((q) => ({
        id: String(q.id ?? q.source ?? ''),
        content: String(q.content ?? ''),
        score: Number(q.score ?? 0),
        source: q.source ?? q.datasetName ?? q.title,
      }))
      .filter((q) => q.id !== '' || q.content !== '')
      .sort((a, b) => b.score - a.score);
    const answer =
      data?.choices?.[0]?.message?.content ?? data?.data?.[0]?.content ?? '';
    const score = quotes.length > 0 ? quotes[0].score : (data?.data?.[0]?.score ?? 0.8);
    return { answer, quotes, score, source };
  }
}
