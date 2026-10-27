/**
 * ReplyQueue — 按 key（chatId:userId）串行的进程内队列
 * - 同一会话严格按入队顺序处理，避免回复/上下文乱序
 * - 队列长度上限与等待超时：超限/超时由调用方回提示，不阻塞其他会话
 * - 多副本场景可替换为 Redis 锁/持久队列（接口保持不变）
 */
export class QueueOverflowError extends Error {
  readonly code = 'REPLY_QUEUE_OVERFLOW';
  constructor(readonly key: string) {
    super(`reply queue overflow for ${key}`);
    this.name = 'QueueOverflowError';
  }
}

export class QueueWaitTimeoutError extends Error {
  readonly code = 'REPLY_QUEUE_TIMEOUT';
  constructor(readonly key: string) {
    super(`reply queue wait timeout for ${key}`);
    this.name = 'QueueWaitTimeoutError';
  }
}

export class ReplyQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Map<string, number>();

  constructor(
    private readonly maxPerKey: number,
    private readonly waitTimeoutMs: number,
  ) {}

  depth(key: string): number {
    return this.pending.get(key) ?? 0;
  }

  run(key: string, task: () => Promise<void>): Promise<void> {
    const depth = this.depth(key);
    if (depth >= this.maxPerKey) return Promise.reject(new QueueOverflowError(key));
    this.pending.set(key, depth + 1);
    const enqueuedAt = Date.now();
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        if (this.waitTimeoutMs > 0 && Date.now() - enqueuedAt > this.waitTimeoutMs) {
          throw new QueueWaitTimeoutError(key);
        }
        await task();
      })
      .finally(() => {
        const left = (this.pending.get(key) ?? 1) - 1;
        if (left <= 0) this.pending.delete(key);
        else this.pending.set(key, left);
        if (this.tails.get(key) === next) this.tails.delete(key);
      });
    this.tails.set(key, next);
    return next;
  }
}
