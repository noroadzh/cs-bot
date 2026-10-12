/**
 * 企微 API 统一客户端
 * access_token 内存缓存 7000s + Redis SETNX 分布式锁
 */
import axios, { AxiosInstance } from 'axios';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { ErrCode } from '@cs-bot/shared';

const TOKEN_TTL = 7000;
const TOKEN_LOCK_TTL = 10;
const TOKEN_LOCK_KEY = 'wecom:at:lock';

export class WecomClient {
  private readonly logger = new AppLogger('WecomClient');
  private readonly api: AxiosInstance;
  private readonly redis: Redis;
  private tokenCache: { token: string; expireAt: number } | null = null;

  constructor(config: ConfigService) {
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
    if (this.tokenCache && Date.now() < this.tokenCache.expireAt) return this.tokenCache.token;
    try {
      const cached = await this.redis.get('wecom:at');
      if (cached) {
        const ttl = await this.redis.ttl('wecom:at');
        if (ttl > 0) {
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
      const resp = await this.api.get('/gettoken', {
        params: { corpid: cfg.WECHAT_CORP_ID, corpsecret: cfg.WECHAT_AGENT_SECRET },
      });
      const data = resp.data as { errcode: number; errmsg?: string; access_token?: string; expires_in?: number };
      if (data.errcode !== 0) throw new Error(data.errmsg ?? 'gettoken fail');
      const token = data.access_token!;
      const expiresIn = data.expires_in ?? TOKEN_TTL;
      await this.redis.set('wecom:at', token, 'EX', Math.min(expiresIn, TOKEN_TTL));
      this.tokenCache = { token, expireAt: Date.now() + expiresIn * 1000 };
      return token;
    } finally {
      if (lockAcquired) await this.redis.del(TOKEN_LOCK_KEY).catch(() => {});
    }
  }

  async sendText(chatId: string, content: string, atUser?: string): Promise<void> {
    const token = await this.getAccessToken();
    const body: Record<string, unknown> = {
      chatid: chatId, msgtype: 'text',
      text: { content }, clientmsgid: crypto.randomUUID(),
    };
    if (atUser) (body as any).atuserlist = atUser;
    const resp = await this.api.post('/appchat/send', body, { params: { access_token: token } });
    if ((resp.data as any).errcode !== 0) {
      throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_SEND_FAIL });
    }
  }

  async sendFile(chatId: string, mediaId: string): Promise<void> {
    const token = await this.getAccessToken();
    const resp = await this.api.post('/appchat/send', {
      chatid: chatId, msgtype: 'file',
      file: { media_id: mediaId }, clientmsgid: crypto.randomUUID(),
    }, { params: { access_token: token } });
    if ((resp.data as any).errcode !== 0) {
      throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_SEND_FAIL });
    }
  }

  async sendVideo(chatId: string, mediaId: string, title?: string): Promise<void> {
    const token = await this.getAccessToken();
    const resp = await this.api.post('/appchat/send', {
      chatid: chatId, msgtype: 'video',
      video: { media_id: mediaId, title: title ?? '', description: title ?? '' },
      clientmsgid: crypto.randomUUID(),
    }, { params: { access_token: token } });
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
      const resp = await this.api.post('/media/upload', form, {
        params: { access_token: token, type },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if ((resp.data as any).errcode !== 0) {
        throw Object.assign(new Error((resp.data as any).errmsg), { code: ErrCode.WECOM_UPLOAD_FAIL });
      }
      return (resp.data as any).media_id;
    };
    try { return await doUpload(); } catch { return await doUpload(); }
  }

  async downloadMedia(mediaId: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    const resp = await this.api.get('/media/get', {
      params: { access_token: token, media_id: mediaId },
      responseType: 'arraybuffer',
    });
    return Buffer.from(resp.data);
  }

  async activeSend(traceId: string, chatId: string, content: string): Promise<void> {
    await this.sendText(chatId, content);
    this.logger.log({ traceId, chatId, action: 'active-send' });
  }
}
