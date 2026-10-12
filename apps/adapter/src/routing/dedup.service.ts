/** DedupService */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';

const DEDUP_TTL = 172800;

@Injectable()
export class DedupService {
  private readonly redis: Redis;

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
      return false;
    }
  }
}
