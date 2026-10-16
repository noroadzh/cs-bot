/**
 * 图片识别服务
 * 真实实现：调 Qwen-VL（OpenAI 兼容 chat completions 风格 + messages 数组含 image_url）
 * Mock 实现：返回固定中文描述，便于开发/测试
 */
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';

export const IRECOGNIZE_ENGINE = Symbol('IRecognizeEngine');

export interface IRecognizeEngine {
  recognize(buf: Buffer, mimeType: string): Promise<string>;
}

const SUPPORTED_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

@Injectable()
export class MediaRecognizeService {
  private readonly logger = new Logger(MediaRecognizeService.name);
  private readonly api: AxiosInstance | null;
  private readonly useMock: boolean;

  constructor(private readonly config: ConfigService) {
    const cfg = ConfigService.instance;
    this.useMock = cfg.USE_MOCK_LLM || !cfg.QWEN_VL_BASE_URL || !cfg.QWEN_VL_API_KEY;
    if (this.useMock) {
      this.api = null;
      this.logger.log({ phase: 'ready', detail: 'media recognize mock mode' });
    } else {
      this.api = axios.create({
        baseURL: cfg.QWEN_VL_BASE_URL,
        timeout: cfg.LLM_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${cfg.QWEN_VL_API_KEY}` },
      });
    }
  }

  isSupportedMediaType(mimeType: string): boolean {
    return SUPPORTED_MIME.has(mimeType);
  }

  async recognizeImage(buf: Buffer, mimeType: string = 'image/jpeg'): Promise<string> {
    if (!buf || buf.length === 0) return '';
    if (!this.isSupportedMediaType(mimeType)) {
      this.logger.warn({ phase: 'skip', detail: 'unsupported mime', mimeType });
      return '';
    }
    return this.callEngine(buf, mimeType);
  }

  async recognizeImageFromUrl(url: string): Promise<string> {
    if (!url) return '';
    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: ConfigService.instance.LLM_TIMEOUT_MS,
      });
      const buf = Buffer.from(resp.data);
      return this.recognizeImage(buf, 'image/jpeg');
    } catch (err) {
      this.logger.error({ phase: 'error', detail: 'recognize-image-url', err: (err as Error).message });
      return '';
    }
  }

  private async callEngine(buf: Buffer, mimeType: string): Promise<string> {
    if (this.useMock) {
      return mockDescribe(buf, mimeType);
    }
    try {
      const dataUrl = `data:${mimeType};base64,${buf.toString('base64')}`;
      const resp = await this.api!.post(
        '/v1/chat/completions',
        {
          model: 'qwen-vl-plus',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: '请用一段中文简短描述这张图片的主要内容。' },
              ],
            },
          ],
          max_tokens: 256,
        },
      );
      const text = (resp.data as any)?.choices?.[0]?.message?.content ?? '';
      return typeof text === 'string' ? text : '';
    } catch (err) {
      this.logger.error({ phase: 'error', detail: 'qwen-vl-call', err: (err as Error).message });
      return '';
    }
  }
}

function mockDescribe(_buf: Buffer, mimeType: string): string {
  return `用户发送了一张 ${mimeType} 图片（mock 模式：图片识别未启用真实模型）。`;
}
