/**
 * QaPairing — 会话切分与 QA 配对（概设 §5 M10 步骤 4）
 *
 * 按（会话标识 + 客户标识）分组；间隔 > 30min 切分窗口；
 * 窗口内客户侧消息聚合为「问」，客服侧实质回复为「答」；
 * 同话题多轮合并（问取首条、答取末条）；单边消息入未配对池。
 */
import type { CleanMessage } from './import-cleaner.js';

export interface PairedItem {
  question: string;
  answer: string;
  /** 会话标识（直接配对格式为 undefined） */
  conversationId?: string;
  /** 问题首条消息的原始时间（毫秒） */
  occurredAt?: number;
}

export interface PairResult {
  paired: PairedItem[];
  unpaired: CleanMessage[];
}

export class QaPairing {
  constructor(
    private readonly gapMs = 30 * 60_000,
    private readonly minAnswerChars = 6,
  ) {}

  pair(messages: readonly CleanMessage[]): PairResult {
    const paired: PairedItem[] = [];
    const unpaired: CleanMessage[] = [];

    const groups = new Map<string, CleanMessage[]>();
    for (const m of messages) {
      const key = m.conversationId || 'default';
      const arr = groups.get(key);
      if (arr) arr.push(m);
      else groups.set(key, [m]);
    }

    for (const msgs of groups.values()) {
      msgs.sort((a, b) => a.occurredAt - b.occurredAt);
      let window: CleanMessage[] = [];
      for (const m of msgs) {
        const prev = window[window.length - 1];
        if (prev && m.occurredAt - prev.occurredAt > this.gapMs) {
          this.pairWindow(window, paired, unpaired);
          window = [];
        }
        window.push(m);
      }
      if (window.length > 0) this.pairWindow(window, paired, unpaired);
    }

    return { paired, unpaired };
  }

  private pairWindow(
    window: CleanMessage[],
    paired: PairedItem[],
    unpaired: CleanMessage[],
  ): void {
    pairWindow(window, paired, unpaired, this.minAnswerChars);
  }
}

/** 单窗口配对（供全量/流式共用） */
export function pairWindow(
  window: readonly CleanMessage[],
  paired: PairedItem[],
  unpaired: CleanMessage[],
  minAnswerChars = 6,
): void {
  // 按轮次配对：客户连续消息聚合为「问」，其后的实质客服回复为「答」结束一轮；
  // 每轮产出一条 item；最终未获得回复的客户消息入未配对池。
  let qBuf: string[] = [];
  let pendingCustomers: CleanMessage[] = [];

  for (const m of window) {
    if (m.senderType === 'customer') {
      qBuf.push(m.content);
      pendingCustomers.push(m);
    } else if (
      m.senderType === 'service' &&
      qBuf.length > 0 &&
      m.content.trim().length >= minAnswerChars
    ) {
      const first = pendingCustomers[0];
      paired.push({
        question: qBuf.join(' '),
        answer: m.content,
        conversationId: first?.conversationId,
        occurredAt: first?.occurredAt,
      });
      qBuf = [];
      pendingCustomers = [];
    }
  }

  for (const m of pendingCustomers) unpaired.push(m);
}

/**
 * 流式配对：输入按 (conversationId, occurredAt) 有序时，只保留当前会话的一个窗口。
 * 输出通过 drain() 分批取走。
 */
export class StreamingQaPairing {
  private conversation = '';
  private window: CleanMessage[] = [];
  private paired: PairedItem[] = [];
  private unpaired: CleanMessage[] = [];

  constructor(
    private readonly gapMs = 30 * 60_000,
    private readonly minAnswerChars = 6,
  ) {}

  push(m: CleanMessage): void {
    if (m.conversationId !== this.conversation) {
      this.flushWindow();
      this.conversation = m.conversationId;
    }
    const prev = this.window[this.window.length - 1];
    if (prev && m.occurredAt - prev.occurredAt > this.gapMs) this.flushWindow();
    this.window.push(m);
  }

  finish(): void {
    this.flushWindow();
  }

  drain(): PairResult {
    const out = { paired: this.paired, unpaired: this.unpaired };
    this.paired = [];
    this.unpaired = [];
    return out;
  }

  private flushWindow(): void {
    if (this.window.length === 0) return;
    pairWindow(this.window, this.paired, this.unpaired, this.minAnswerChars);
    this.window = [];
  }
}
