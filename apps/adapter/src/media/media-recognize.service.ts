/**
 * 图片识别服务
 * 真实实现：调 Qwen-VL（OpenAI 兼容 chat completions 风格 + messages 数组含 image_url）
 * Mock 实现：返回固定中文描述，便于开发/测试
 */
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '../config/config.service.js';
import { vlSemaphore } from '../common/semaphore.js';

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
        timeout: 10_000,
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
        timeout: 10_000,
      });
      const buf = Buffer.from(resp.data);
      // MIME 取自响应头而非写死：企微下载的图可能是 png/webp，写死 jpeg 会让识别走错分支。
      // 头缺失时才回落 jpeg（保留旧行为），头存在但不在白名单则由 recognizeImage 记 skip。
      const mimeType = parseMimeType(resp.headers?.['content-type']) ?? 'image/jpeg';
      return this.recognizeImage(buf, mimeType);
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
      const resp = await vlSemaphore().run(() => this.api!.post(
        '/v1/chat/completions',
        {
          model: ConfigService.instance.QWEN_VL_MODEL || 'qwen-vl-plus',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: dataUrl } },
                { type: 'text', text: '提取图片中与咨询/操作相关的文字，归纳为一句中文问题；无有效内容时仅返回 [NO_TEXT]' },
              ],
            },
          ],
          max_tokens: 256,
        },
      ));
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

/**
 * 从 HTTP Content-Type 头解析出干净的 MIME 字符串。
 * - 大小写 / charset / boundary 等参数全部忽略
 * - 头缺失或解析失败 → null（由调用方决定是否回落）
 * 入参用 `unknown` 以兼容 axios 的 AxiosHeaderValue（包含 string | string[] | null）。
 */
export function parseMimeType(contentTypeHeader: unknown): string | null {
  if (contentTypeHeader == null) return null;
  const raw = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader;
  if (typeof raw !== 'string' || !raw) return null;
  const semi = raw.indexOf(';');
  const mime = (semi >= 0 ? raw.slice(0, semi) : raw).trim().toLowerCase();
  return mime || null;
}
