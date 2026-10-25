/** FastGPTQaEngine */
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { Err, Ok, ErrCode, type IQAEngine, type AskReq, type AskResult } from '@cs-bot/shared';
import { ApprovedQaService } from './approved-qa.service.js';

export class FastGPTQaEngine implements IQAEngine {
  readonly mode: 'fastgpt' = 'fastgpt';
  private readonly primary: AxiosInstance;
  private readonly fallback: AxiosInstance | null;
  private readonly logger = new AppLogger('FastGPTQaEngine');
  private readonly cfg = ConfigService.instance;
  private readonly approvedQa: ApprovedQaService;

  constructor(_config: ConfigService, approvedQaService?: ApprovedQaService) {
    this.primary = axios.create({
      baseURL: this.cfg.FASTGPT_BASE_URL,
      timeout: this.cfg.LLM_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${this.cfg.FASTGPT_API_KEY}` },
    });
    // Fallback LLM (LLM_FALLBACK_*): 当 primary 抛错时尝试一次。env 未配则不启用。
    const fbBase = this.cfg.LLM_FALLBACK_BASE_URL;
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

    // 优先级 3: fallback LLM
    if (this.fallback) {
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
    try {
      const resp = await client.post('/api/v1/chat/completions', {
        model: 'fastgpt',
        messages: [
          ...(req.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          { role: 'user', content: req.question },
        ],
        datasetIds: (req.datasetIds ?? (this.cfg.FASTGPT_DATASET_IDS ? [this.cfg.FASTGPT_DATASET_IDS] : [])),
      });
      const data = resp.data as { choices?: Array<{ message?: { content?: string } }>; data?: Array<{ score?: number; content?: string }> };
      const answer = data?.choices?.[0]?.message?.content ?? data?.data?.[0]?.content ?? '';
      const score = data?.data?.[0]?.score ?? 0.8;
      return { ok: true, value: { answer, quotes: [], score, source } };
    } catch (err) {
      this.logger.error({ source, err: (err as Error).message });
      return new Err({ code: ErrCode.LLM_TIMEOUT, message: (err as Error).message });
    }
  }
}
