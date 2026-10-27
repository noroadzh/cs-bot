/** RateLimiterService：群级 20/min + 用户级 5/min */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';

const LUA_TOKEN_BUCKET = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end
if current > limit then
  return 1
end
return 0
`;

@Injectable()
export class RateLimiterService {
  private readonly redis: Redis;
  private readonly groupLimit: number;
  private readonly userLimit: number;
  private sha = '';

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.redis = new Redis({
      host: cfg.REDIS_HOST, port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined, lazyConnect: true,
    });
    this.groupLimit = cfg.RATE_GROUP_PER_MIN;
    this.userLimit = cfg.RATE_USER_PER_MIN;
  }

  /** 群超限提示去重：同一群 5 分钟内最多提示一次 */
  async shouldHint(chatId: string): Promise<boolean> {
    try {
      const r = await this.redis.set(`rate:hint:${chatId}`, '1', 'EX', 300, 'NX');
      return r === 'OK';
    } catch {
      return true;
    }
  }

  async check(chatId: string, userId: string): Promise<{ allowed: boolean; scope?: 'group' | 'user' }> {
    const now = Math.floor(Date.now() / 1000);
    const minute = Math.floor(now / 60);
    const groupKey = `rate:group:${chatId}:${minute}`;
    const userKey = `rate:user:${chatId}:${userId}:${minute}`;
    try {
      if (!this.sha) {
        try { this.sha = (await this.redis.script('LOAD', LUA_TOKEN_BUCKET)) as string; } catch { this.sha = ''; }
      }
      const runScript = async (key: string, limit: number): Promise<number> => {
        if (this.sha) return (await this.redis.evalsha(this.sha, 1, key, String(limit), '60', String(now))) as number;
        const current = await this.redis.incr(key);
        if (current === 1) await this.redis.expire(key, 60);
        return current > limit ? 1 : 0;
      };
      const userOver = await runScript(userKey, this.userLimit);
      if (userOver) return { allowed: false, scope: 'user' };
      const groupOver = await runScript(groupKey, this.groupLimit);
      if (groupOver) return { allowed: false, scope: 'group' };
      return { allowed: true };
    } catch {
      return { allowed: true };
    }
  }
}
