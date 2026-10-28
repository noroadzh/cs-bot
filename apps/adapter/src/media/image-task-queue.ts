/**
 * 图片识别后台队列：回调先 ack，再串行处理；同 msgId 去重，满队列拒绝。
 */
export type EnqueueResult = 'accepted' | 'duplicate' | 'full';

export class ImageTaskQueue {
  private readonly queue: Array<{ key: string; run: () => Promise<void> }> = [];
  private readonly known = new Set<string>();
  private running = false;
  private readonly idle: Array<() => void> = [];

  constructor(private readonly max = 100) {}

  enqueue(key: string, run: () => Promise<void>): EnqueueResult {
    if (this.known.has(key)) return 'duplicate';
    if (this.queue.length + (this.running ? 1 : 0) >= this.max) return 'full';
    this.known.add(key);
    this.queue.push({ key, run });
    void this.drain();
    return 'accepted';
  }

  onIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const task = this.queue.shift();
        if (!task) break;
        try {
          await task.run();
        } finally {
          this.known.delete(task.key);
        }
      }
    } finally {
      this.running = false;
      if (this.queue.length === 0) {
        for (const resolve of this.idle.splice(0)) resolve();
      }
    }
  }
}
