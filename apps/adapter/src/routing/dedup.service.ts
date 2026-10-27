/** DedupService */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';

const DEDUP_TTL = 172800;

@Injectable()
export class DedupService {
  private readonly redis: Redis;
  /** Redis 故障时的进程内兜底（T TL 与 Redis 一致，容量上限防胀） */
  private readonly memory = new Map<string, number>();
  private static readonly MEMORY_MAX = 10_000;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.redis = new Redis({
      host: cfg.REDIS_HOST, port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined, lazyConnect: true,
    });
  }

  async isDuplicate(msgId: string): Promise<boolean> {
    if (!msgId) return false;
    try {
      const res = await this.redis.set(`dedup:${msgId}`, '1', 'EX', DEDUP_TTL, 'NX');
      return res !== 'OK';
    } catch {
      return this.isDuplicateLocal(msgId);
    }
  }

  private isDuplicateLocal(msgId: string): boolean {
    const now = Date.now();
    if (this.memory.size >= DedupService.MEMORY_MAX) {
      for (const [k, exp] of this.memory) if (exp <= now) this.memory.delete(k);
      if (this.memory.size >= DedupService.MEMORY_MAX) {
        const oldest = this.memory.keys().next().value;
        if (oldest !== undefined) this.memory.delete(oldest);
      }
    }
    const exp = this.memory.get(msgId);
    if (exp !== undefined && exp > now) return true;
    this.memory.set(msgId, now + DEDUP_TTL * 1000);
    return false;
  }
}
