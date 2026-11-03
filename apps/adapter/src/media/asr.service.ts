/**
 * ASR：OpenAI-compatible transcription（DashScope / whisper）
 * 失败由调用方写 miss + 引导话术
 */
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

@Injectable()
export class AsrService {
  private readonly logger = new AppLogger('AsrService');

  enabled(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(cfg.ASR_BASE_URL && cfg.ASR_API_KEY);
  }

  async transcribe(buf: Buffer, filename = 'audio.amr'): Promise<string> {
    const cfg = ConfigService.instance;
    if (!this.enabled()) throw new Error('ASR not configured');
    const form = new FormData();
    form.append('file', buf, { filename });
    form.append('model', cfg.ASR_MODEL || 'whisper-1');
    const res = await axios.post(
      `${String(cfg.ASR_BASE_URL).replace(/\/+$/, '')}/audio/transcriptions`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${cfg.ASR_API_KEY}`,
        },
        timeout: cfg.ASR_TIMEOUT_MS ?? 60_000,
        maxBodyLength: Infinity,
      },
    );
    const text = String(res.data?.text ?? res.data?.data?.text ?? '').trim();
    if (!text) throw new Error('ASR empty transcript');
    this.logger.log({ detail: 'asr-ok', bytes: buf.length });
    return text;
  }
}
