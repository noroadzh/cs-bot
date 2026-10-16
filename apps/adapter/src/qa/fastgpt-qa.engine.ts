/** FastGPTQaEngine */
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { Err, ErrCode, type IQAEngine, type AskReq, type AskResult } from '@cs-bot/shared';

export class FastGPTQaEngine implements IQAEngine {
  readonly mode: 'fastgpt' = 'fastgpt';
  private readonly primary: AxiosInstance;
  private readonly fallback: AxiosInstance | null;
  private readonly logger = new AppLogger('FastGPTQaEngine');
  private readonly cfg = ConfigService.instance;

  constructor(_config: ConfigService) {
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
  }

  async ask(req: AskReq): Promise<AskResult> {
    const primaryResp = await this.call(this.primary, req, 'primary');
    if (primaryResp.ok) return primaryResp;
    if (!this.fallback) return primaryResp;
    // ts-jest 跑的是非 strict 模式，`primaryResp.ok` 不会窄化类型。
    // 显式断言到 Err 侧以读取 .error（与 Result 判别联合的运行时形状一致）。
    const rawErr: unknown = (primaryResp as Err<{ code: number; message: string }>).error;
    const errMsg = rawErr instanceof Error ? rawErr.message : String(rawErr);
    this.logger.warn({ detail: 'fallback-trigger', primaryErr: errMsg });
    return await this.call(this.fallback, req, 'fallback');
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
