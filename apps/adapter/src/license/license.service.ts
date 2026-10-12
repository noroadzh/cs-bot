/** LicenseService */
import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '../config/config.service.js';
import { ILicenseVerifier, type LicenseState } from './license.types.js';
import { MockLicenseVerifier } from './mock-license.verifier.js';
import { AppLogger } from '../common/logger.js';

const CACHE_KEY = 'license:cache';
const CACHE_TTL = 3600;

@Injectable()
export class LicenseService {
  private readonly logger = new AppLogger('LicenseService');
  private readonly verifier: ILicenseVerifier;
  private readonly redis: Redis;

  constructor(_config: ConfigService) {
    const cfg = ConfigService.instance;
    this.verifier = cfg.USE_MOCK_LICENSE
      ? new MockLicenseVerifier({ LICENSE_FILE: cfg.LICENSE_FILE } as any)
      : new MockLicenseVerifier({ LICENSE_FILE: cfg.LICENSE_FILE } as any);
    this.redis = new Redis({
      host: cfg.REDIS_HOST, port: cfg.REDIS_PORT,
      password: cfg.REDIS_PASSWORD || undefined, lazyConnect: true,
    });
  }

  async verifyAndCache(): Promise<LicenseState> {
    try {
      const cached = await this.redis.get(CACHE_KEY);
      if (cached) return JSON.parse(cached) as LicenseState;
    } catch { /* ignore */ }
    const state = await this.verifier.verify();
    try { await this.redis.set(CACHE_KEY, JSON.stringify(state), 'EX', CACHE_TTL); } catch { /* ignore */ }
    if (!state.valid) this.logger.warn({ detail: 'license-invalid', reason: state.reason, mock: state.mock });
    else this.logger.log({ detail: 'license-ok', mock: state.mock, daysLeft: state.daysLeft });
    return state;
  }

  async invalidateCache(): Promise<void> { await this.redis.del(CACHE_KEY).catch(() => {}); }

  async reload(): Promise<LicenseState> {
    await this.invalidateCache();
    return this.verifyAndCache();
  }
}
