/**
 * 导入后台任务队列（进程内、串行）
 */
export class ImportTaskQueue {
  private readonly queue: Array<() => Promise<void>> = [];
  private running = false;

  constructor(private readonly max = 10) {}

  enqueue(run: () => Promise<void>): boolean {
    if (this.queue.length >= this.max) return false;
    this.queue.push(run);
    void this.drain();
    return true;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const task = this.queue.shift();
        if (!task) break;
        try {
          await task();
        } catch {
          /* 任务内部已记录失败 */
        }
      }
    } finally {
      this.running = false;
    }
  }
}
