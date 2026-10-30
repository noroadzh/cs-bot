/**
 * 企微 API 统一客户端
 * access_token 内存缓存 7000s + Redis SETNX 分布式锁
 */
import axios, { AxiosInstance } from 'axios';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';
import type { IMessageSender } from '../qa/message-sender.port.js';
import { wecomSemaphore } from '../common/semaphore.js';
import type { UsageService } from '../usage/usage.service.js';

const TOKEN_TTL = 7000;
/** 提前刷新量：剩余不足该秒数即视为过期，避免临界请求失败（概设 M1） */
const TOKEN_REFRESH_LEAD_SEC = 300;
const TOKEN_LOCK_TTL = 10;
const TOKEN_LOCK_KEY = 'wecom:at:lock';

export class WecomClient implements IMessageSender {
  private readonly logger = new AppLogger('WecomClient');
  private readonly api: AxiosInstance;
  private readonly redis: Redis;
  private tokenCache: { token: string; expireAt: number } | null = null;

  constructor(config: ConfigService, private readonly usage?: UsageService) {
    const cfg = ConfigService.instance;
    this.api = axios.create({ baseURL: 'https://qyapi.weixin.qq.com/cgi-bin', timeout: 10000 });
    this.redis = new Redis({
      host: cfg.REDIS_HOST,
      port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined,
      lazyConnect: true,
    });
  }

  async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expireAt - TOKEN_REFRESH_LEAD_SEC * 1000) {
      return this.tokenCache.token;
    }
    try {
      const cached = await this.redis.get('wecom:at');
      if (cached) {
        const ttl = await this.redis.ttl('wecom:at');
        if (ttl > TOKEN_REFRESH_LEAD_SEC) {
          this.tokenCache = { token: cached, expireAt: Date.now() + ttl * 1000 };
          return cached;
        }
      }
    } catch { /* ignore */ }

    const lockAcquired = await this.redis.set(TOKEN_LOCK_KEY, '1', 'EX', TOKEN_LOCK_TTL, 'NX');
    if (!lockAcquired) {
      await new Promise((r) => setTimeout(r, 2000));
      const cached = await this.redis.get('wecom:at');
      if (cached) return cached;
    }

    const cfg = ConfigService.instance;
    try {
      const resp = await wecomSemaphore().run(() => this.api.get('/gettoken', {
        params: { corpid: cfg.WECHAT_CORP_ID, corpsecret: cfg.WECHAT_AGENT_SECRET },
      }));
      const data = resp.data as { errcode: number; errmsg?: string; access_token?: string; expires_in?: number };
      if (data.errcode !== 0) {
        throw Object.assign(new Error(data.errmsg ?? 'gettoken fail'), { errcode: data.errcode });
      }
      const token = data.access_token!;
      const expiresIn = data.expires_in ?? TOKEN_TTL;
      await this.redis.set('wecom:at', token, 'EX', Math.min(expiresIn, TOKEN_TTL));
      this.tokenCache = { token, expireAt: Date.now() + expiresIn * 1000 };
      return token;
    } finally {
      if (lockAcquired) await this.redis.del(TOKEN_LOCK_KEY).catch(() => {});
    }
  }

  async sendText(chatId: string, content: string, atUser?: string, clientMsgId?: string): Promise<void> {
    const id = clientMsgId ?? crypto.randomUUID();
    await this.withSendRetry('sendText', async () => {
      const token = await this.getAccessToken();
      const body: Record<string, unknown> = {
        chatid: chatId, msgtype: 'text',
        text: { content }, clientmsgid: id,
      };
      if (atUser) (body as any).atuserlist = atUser;
      const resp = await wecomSemaphore().run(() =>
        this.api.post('/appchat/send', body, { params: { access_token: token } }),
      );
      const data = resp.data as { errcode: number; errmsg?: string };
      if (data.errcode !== 0) {
        throw Object.assign(new Error(data.errmsg ?? 'send failed'), {
          code: ErrCode.WECOM_SEND_FAIL,
          errcode: data.errcode,
        });
      }
    });
  }

  /** 出站重试：token 失效刷新一次；网络/45009/5xx 指数退避；clientmsgid 复用保证幂等 */
  private async withSendRetry<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const cfg = ConfigService.instance;
    const max = cfg.WECOM_SEND_MAX_ATTEMPTS ?? 3;
    const base = cfg.WECOM_SEND_BACKOFF_MS ?? 300;
    const maxBackoff = cfg.WECOM_SEND_BACKOFF_MAX_MS ?? 5000;
    let tokenRetried = false;
    for (let attempt = 1; ; attempt++) {
      this.usage?.increment('sendAttempts');
      try {
        return await fn();
      } catch (err) {
        const e = err as Error & { errcode?: number };
        if ([40014, 42001, 40001].includes(e.errcode ?? 0) && !tokenRetried) {
          tokenRetried = true;
          this.tokenCache = null;
          await this.redis.del('wecom:at').catch(() => undefined);
          this.usage?.increment('sendRetries');
          this.logger.warn({ detail: 'send-token-refresh', op, errcode: e.errcode });
          continue;
        }
        const retryable =
          e.errcode === undefined || e.errcode === 45009 || e.errcode >= 50000;
        if (!retryable || attempt >= max) {
          this.usage?.increment('sendFailures');
          throw err;
        }
        this.usage?.increment('sendRetries');
        const delay = Math.min(base * 2 ** (attempt - 1), maxBackoff) + Math.floor(Math.random() * 100);
        this.logger.warn({ detail: 'send-retry', op, attempt, errcode: e.errcode, err: e.message, delayMs: delay });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  async sendFile(chatId: string, mediaId: string): Promise<void> {
    const token = await this.getAccessToken();
    const resp = await wecomSemaphore().run(() =>
      this.api.post('/appchat/send', {
        chatid: chatId, msgtype: 'file',
        file: { media_id: mediaId }, clientmsgid: crypto.randomUUID(),
      }, { params: { access_token: token } }),
    );
    if ((resp.data as any).errcode !== 0) {
      throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_SEND_FAIL });
    }
  }

  async sendVideo(chatId: string, mediaId: string, title?: string): Promise<void> {
    const token = await this.getAccessToken();
    const resp = await wecomSemaphore().run(() =>
      this.api.post('/appchat/send', {
        chatid: chatId, msgtype: 'video',
        video: { media_id: mediaId, title: title ?? '', description: title ?? '' },
        clientmsgid: crypto.randomUUID(),
      }, { params: { access_token: token } }),
    );
    if ((resp.data as any).errcode !== 0) {
      throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_SEND_FAIL });
    }
  }

  async uploadMedia(type: 'file' | 'image' | 'video', filePath: string): Promise<string> {
    const doUpload = async (): Promise<string> => {
      const token = await this.getAccessToken();
      const { default: FormData } = await import('form-data');
      const fs = await import('fs');
      const form = new FormData();
      form.append('media', fs.createReadStream(filePath));
      const resp = await wecomSemaphore().run(() => this.api.post('/media/upload', form, {
        params: { access_token: token, type },
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      if ((resp.data as any).errcode !== 0) {
        throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_UPLOAD_FAIL });
      }
      return (resp.data as any).media_id;
    };
    try { return await doUpload(); } catch { return await doUpload(); }
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    const resp = await wecomSemaphore().run(() => this.api.get('/media/get', {
      params: { access_token: token, media_id: mediaId },
      responseType: 'arraybuffer',
    }));
    return Buffer.from(resp.data);
  }

  async activeSend(traceId: string, chatId: string, content: string): Promise<void> {
    await this.sendText(chatId, content);
    this.logger.log({ traceId, chatId, action: 'active-send' });
  }

  async sendAsset(chatId: string, assetId: string, type: 'link' | 'file' | 'video'): Promise<void> {
    switch (type) {
      case 'link': await this.sendText(chatId, assetId); break;
      case 'file': {
        const mediaId = await this.uploadMedia('file', assetId);
        await this.sendFile(chatId, mediaId);
        break;
      }
      case 'video': {
        const mediaId = await this.uploadMedia('video', assetId);
        await this.sendVideo(chatId, mediaId);
        break;
      }
    }
  }
}
