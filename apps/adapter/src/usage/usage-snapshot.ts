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
  /** 模型通道切云次数（hybrid 本地失败切云；增项 D） */
  llmFailovers: number;
  /** LLM 调用失败次数（双通道失败/超时） */
  llmFailures: number;
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
    llmFailovers: 0,
    llmFailures: 0,
  };
}