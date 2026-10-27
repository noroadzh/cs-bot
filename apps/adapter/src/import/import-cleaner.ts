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

  /** 流式清洗：跨消息保持“同发送方 60s 重复”状态 */
  stream(): { push: (m: CleanMessage) => CleanMessage | null } {
    const opts = this.rules;
    const lastBySender = new Map<string, { content: string; at: number }>();
    const repeatMs = opts.repeatWindowSec * 1000;
    return {
      push: (m: CleanMessage): CleanMessage | null => {
        if (opts.dropSystemMessages && m.senderType === 'system') return null;
        if (opts.dropBotMessages && m.senderType === 'bot') return null;
        const text = m.content.trim();
        if (opts.dropPlaceholders && PLACEHOLDER_RE.test(text)) return null;
        if (effectiveChars(text) < opts.minEffectiveChars) return null;
        const key = `${m.conversationId}:${m.senderId}`;
        const last = lastBySender.get(key);
        if (last && last.content === text && m.occurredAt - last.at <= repeatMs) return null;
        lastBySender.set(key, { content: text, at: m.occurredAt });
        return { ...m, content: text };
      },
    };
  }

  clean(messages: readonly CleanMessage[]): CleanMessage[] {
    const streamer = this.stream();
    const out: CleanMessage[] = [];
    for (const m of messages) {
      const cleaned = streamer.push(m);
      if (cleaned) out.push(cleaned);
    }
    return out;
  }
}
