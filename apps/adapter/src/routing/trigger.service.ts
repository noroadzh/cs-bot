/**
 * TriggerService
 * 触发条件短路判定：isSelfOrBot → 非文本未@ → @解析 → 关键词匹配
 */
import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { ConfigService } from '../config/config.service.js';
import type { InboundMsg } from '../wecom/wecom-crypto.js';

export type TriggerResult =
  | { triggered: true; reason: 'mention' | 'keyword' }
  | { triggered: false; reason: 'self' | 'bot' | 'non_text_no_mention' | 'no_match' };

@Injectable()
export class TriggerService {
  private keywords: string[] = [];
  private keywordCount = 0;
  private readonly botUserId: string;
  private readonly keywordsFile: string;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.botUserId = cfg.WECHAT_BOT_USER_ID;
    this.keywordsFile = cfg.KEYWORDS_FILE;
    this.reload();
  }

  reload(): number {
    try {
      const yaml = load(readFileSync(this.keywordsFile, 'utf8')) as { keywords?: string[] };
      const words = (yaml?.keywords ?? []).filter((w) => typeof w === 'string' && w.trim().length > 0);
      this.keywords = words;
      this.keywordCount = words.length;
      return this.keywordCount;
    } catch {
      return this.keywordCount;
    }
  }

  get count(): number {
    return this.keywordCount;
  }

  evaluate(msg: InboundMsg): TriggerResult {
    if (this.botUserId && msg.FromUserName === this.botUserId) {
      return { triggered: false, reason: 'self' };
    }
    if (msg.MsgType !== 'text' && !msg.mentioned) {
      return { triggered: false, reason: 'non_text_no_mention' };
    }
    if (msg.mentioned) {
      return { triggered: true, reason: 'mention' };
    }
    const text = (msg.text ?? msg.Content ?? '').trim();
    if (this.hasKeyword(text)) {
      return { triggered: true, reason: 'keyword' };
    }
    return { triggered: false, reason: 'no_match' };
  }

  private hasKeyword(text: string): boolean {
    if (!text) return false;
    for (const w of this.keywords) {
      if (text.startsWith(w)) return true;
    }
    return false;
  }
}
