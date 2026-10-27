/**
 * 出站并发信号量（FIFO 排队）——保护 LLM/WeCom/VL 配额与 4C 资源
 */
import { ConfigService } from '../config/config.service.js';

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {
    if (!Number.isFinite(limit) || limit < 1) throw new Error('semaphore limit must be >= 1');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.active -= 1;
    }
  }
}

let llm: Semaphore | null = null;
let wecom: Semaphore | null = null;
let vl: Semaphore | null = null;

export function llmSemaphore(): Semaphore {
  if (!llm) llm = new Semaphore(ConfigService.instance.LLM_CONCURRENCY ?? 4);
  return llm;
}

export function wecomSemaphore(): Semaphore {
  if (!wecom) wecom = new Semaphore(ConfigService.instance.WECOM_CONCURRENCY ?? 8);
  return wecom;
}

export function vlSemaphore(): Semaphore {
  if (!vl) vl = new Semaphore(ConfigService.instance.VL_CONCURRENCY ?? 2);
  return vl;
}
