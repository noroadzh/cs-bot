/**
 * Usage snapshot entity
 */
export interface UsageSnapshot {
  period: 'daily' | 'weekly' | 'monthly';
  startedAt: string; // ISO timestamp
  counters: UsageCounters;
  generatedAt: string; // ISO timestamp
}

export interface UsageCounters {
  messagesReceived: number;
  messagesAnswered: number;
  messagesRefused: number;
  messagesMissed: number;
  assetsSent: number;
  tokensPrimary: number;
  tokensFallback: number;
  imagesReceived: number;
  imagesRecognized: number;
  imagesSkipped: number;
  /**
   * D10 usage: 触发器命中条数。
   * 区别于 messagesReceived（所有入站消息，含被 dedup / 未触发 / 限流的）。
   * 仅 trigger.evaluate() 命中后由 routing.dispatch 计数。
   */
  messagesTriggered: number;
}

export function createEmptyCounters(): UsageCounters {
  return {
    messagesReceived: 0,
    messagesAnswered: 0,
    messagesRefused: 0,
    messagesMissed: 0,
    assetsSent: 0,
    tokensPrimary: 0,
    tokensFallback: 0,
    imagesReceived: 0,
    imagesRecognized: 0,
    imagesSkipped: 0,
    messagesTriggered: 0,
  };
}