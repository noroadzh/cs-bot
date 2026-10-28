/** ContextService */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';

export interface ContextRound { role: 'user' | 'assistant'; content: string; }

@Injectable()
export class ContextService {
  private readonly logger = new AppLogger('ContextService');
  private readonly redis: Redis;
  private readonly ttl: number;
  private readonly rounds: number;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.redis = new Redis({
      host: cfg.REDIS_HOST, port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined, lazyConnect: true,
    });
    this.ttl = cfg.CONTEXT_TTL_SEC;
    this.rounds = cfg.CONTEXT_ROUNDS ?? 5;
  }

  private key(chatId: string, userId: string): string { return `ctx:${chatId}:${userId}`; }

  async get(chatId: string, userId: string): Promise<ContextRound[]> {
    try {
      const raw = await this.redis.get(this.key(chatId, userId));
      if (!raw) return [];
      return JSON.parse(raw) as ContextRound[];
    } catch { return []; }
  }

  async append(chatId: string, userId: string, round: { question: string; answer: string }): Promise<void> {
    const key = this.key(chatId, userId);
    const rounds = await this.get(chatId, userId);
    rounds.push({ role: 'user', content: round.question });
    rounds.push({ role: 'assistant', content: round.answer });
    const trimmed = rounds.slice(-(this.rounds * 2));
    try {
      const multi = this.redis.multi();
      multi.set(key, JSON.stringify(trimmed), 'EX', this.ttl);
      await multi.exec();
    } catch { /* ignore */ }
  }

  async clear(chatId: string, userId: string): Promise<void> {
    try { await this.redis.del(this.key(chatId, userId)); } catch { /* ignore */ }
  }
}
