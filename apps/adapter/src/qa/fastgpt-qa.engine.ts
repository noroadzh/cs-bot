/** FastGPTQaEngine */
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { Err, ErrCode, type IQAEngine, type AskReq, type AskResult } from '@cs-bot/shared';

export class FastGPTQaEngine implements IQAEngine {
  readonly mode: 'fastgpt' = 'fastgpt';
  private readonly api: AxiosInstance;
  private readonly logger = new AppLogger('FastGPTQaEngine');
  private readonly cfg = ConfigService.instance;

  constructor(_config: ConfigService) {
    this.api = axios.create({
      baseURL: this.cfg.FASTGPT_BASE_URL,
      timeout: this.cfg.LLM_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${this.cfg.FASTGPT_API_KEY}` },
    });
  }

  async ask(req: AskReq): Promise<AskResult> {
    try {
      const resp = await this.api.post('/api/v1/chat/completions', {
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
      return { ok: true, value: { answer, quotes: [], score } };
    } catch (err) {
      this.logger.error({ err: (err as Error).message });
      return new Err({ code: ErrCode.LLM_TIMEOUT, message: (err as Error).message });
    }
  }
}
