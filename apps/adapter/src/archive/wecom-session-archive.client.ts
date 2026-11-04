/**
 * 企微会话存档 IO（与群消息 WecomClient 分离）
 * 实现可替换：HTTP SDK / sidecar；默认按配置拉取 JSON 批次。
 */
import { Injectable } from '@nestjs/common';
import { createHmac } from 'crypto';
import axios from 'axios';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import type { ArchiveMessage } from './archive.service.js';

export interface ArchivePullBatch {
  messages: ArchiveMessage[];
  nextCursor: string;
}

@Injectable()
export class WecomSessionArchiveClient {
  private readonly logger = new AppLogger('WecomSessionArchiveClient');

  enabled(): boolean {
    const cfg = ConfigService.instance;
    return Boolean(cfg.WECOM_ARCHIVE_ENABLED && cfg.WECOM_ARCHIVE_PULL_URL);
  }

  async pull(cursor: string): Promise<ArchivePullBatch> {
    if (!this.enabled()) {
      const err = new Error('ARCHIVE_PULL_DISABLED');
      (err as Error & { errCode?: string }).errCode = 'ARCHIVE_PULL_DISABLED';
      throw err;
    }
    const cfg = ConfigService.instance;
    try {
      const res = await axios.get(String(cfg.WECOM_ARCHIVE_PULL_URL), {
        params: { cursor: cursor || undefined },
        headers: cfg.WECOM_ARCHIVE_SECRET
          ? { Authorization: `Bearer ${cfg.WECOM_ARCHIVE_SECRET}` }
          : undefined,
        timeout: cfg.WECOM_ARCHIVE_PULL_TIMEOUT_MS ?? 15_000,
        validateStatus: (s) => s >= 200 && s < 300,
      });
      const raw = Array.isArray(res.data?.messages) ? res.data.messages : [];
      const messages: ArchiveMessage[] = raw
        .map((m: Record<string, unknown>) => ({
          msgId: String(m.msgId ?? m.msgid ?? ''),
          chatId: String(m.chatId ?? m.roomid ?? ''),
          from: String(m.from ?? m.sender ?? ''),
          content: String(m.content ?? m.text ?? ''),
          msgTime: Number(m.msgTime ?? m.msgtime ?? Date.now()),
        }))
        .filter((m: ArchiveMessage) => m.msgId);
      const nextCursor = String(res.data?.nextCursor ?? res.data?.cursor ?? cursor);
      this.logger.log({ detail: 'archive-pull-ok', count: messages.length });
      return { messages, nextCursor };
    } catch (err) {
      if ((err as Error & { errCode?: string }).errCode === 'ARCHIVE_PULL_DISABLED') throw err;
      const e = new Error('ARCHIVE_SDK_AUTH_FAILED');
      (e as Error & { errCode?: string }).errCode = 'ARCHIVE_SDK_AUTH_FAILED';
      this.logger.warn({ detail: 'archive-pull-fail', err: (err as Error).message });
      throw e;
    }
  }

  /** 回调验签：共享 secret 与 body 的 HMAC-SHA256 hex；secret 空则跳过 */
  verifyCallbackSignature(rawBody: string, signature: string | undefined): boolean {
    const secret = ConfigService.instance.WECOM_ARCHIVE_CALLBACK_SECRET || '';
    if (!secret) return true;
    if (!signature) return false;
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    return expected === signature;
  }
}
