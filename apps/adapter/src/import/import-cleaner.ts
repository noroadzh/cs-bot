/**
 * ImportCleaner — 清洗规则（概设 §5 M10 步骤 3）
 *
 * 规则来自 config/import-rules.yml（可热加载）：
 *   - 剔除系统消息（入群/退群/撤回）
 *   - 剔除占位消息（图片/语音/视频/文件/表情）
 *   - 剔除机器人自身消息
 *   - 同发送方 60s 内重复内容仅留 1 条
 *   - 有效字符 < N 的无实义短消息
 */
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export type SenderType = 'customer' | 'service' | 'system' | 'bot';

export interface CleanMessage {
  conversationId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  /** epoch ms */
  occurredAt: number;
}

export interface CleanRules {
  dropSystemMessages: boolean;
  dropPlaceholders: boolean;
  dropBotMessages: boolean;
  repeatWindowSec: number;
  minEffectiveChars: number;
}

export const DEFAULT_CLEAN_RULES: CleanRules = {
  dropSystemMessages: true,
  dropPlaceholders: true,
  dropBotMessages: true,
  repeatWindowSec: 60,
  minEffectiveChars: 4,
};

const PLACEHOLDER_RE = /^\[(图片|语音|视频|文件|表情|动画表情|链接|位置|名片)\]$/;

/** 有效字符数：去掉空白与常见标点 */
export function effectiveChars(text: string): number {
  return text.replace(/[\s，。！？、,.!?;:：；…~～"'"'()（）\-—]/g, '').length;
}

export class ImportCleaner {
  constructor(private readonly rules: CleanRules = DEFAULT_CLEAN_RULES) {}

  static fromFile(path: string): ImportCleaner {
    try {
      const doc = yaml.load(readFileSync(path, 'utf8')) as
        | { cleaning?: Partial<CleanRules> }
        | null;
      const c = doc?.cleaning ?? {};
      return new ImportCleaner({ ...DEFAULT_CLEAN_RULES, ...c });
    } catch {
      return new ImportCleaner();
    }
  }

  get currentRules(): CleanRules {
    return { ...this.rules };
  }

  clean(messages: readonly CleanMessage[]): CleanMessage[] {
    const opts = this.rules;
    const out: CleanMessage[] = [];
    const lastBySender = new Map<string, { content: string; at: number }>();
    const repeatMs = opts.repeatWindowSec * 1000;

    for (const m of messages) {
      if (opts.dropSystemMessages && m.senderType === 'system') continue;
      if (opts.dropBotMessages && m.senderType === 'bot') continue;
      const text = m.content.trim();
      if (opts.dropPlaceholders && PLACEHOLDER_RE.test(text)) continue;
      if (effectiveChars(text) < opts.minEffectiveChars) continue;
      const key = `${m.conversationId}:${m.senderId}`;
      const last = lastBySender.get(key);
      if (last && last.content === text && m.occurredAt - last.at <= repeatMs) continue;
      lastBySender.set(key, { content: text, at: m.occurredAt });
      out.push({ ...m, content: text });
    }
    return out;
  }
}
