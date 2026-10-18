/**
 * License 校验服务
 *
 * 启动序（B.5 / SPEC 3.1.12）：
 *   Config → License.startupCheck → Redis → PG → HTTP listen
 *
 * startupCheck 四步：
 *   1. fingerprint()  → expectedFingerprint
 *   2. selfcheck()    → clean:false 时 log evidence + exit(1)
 *   3. verify()       → mock 或 native
 *   4. 终态判定       → production && !valid → exit(1)；否则 warn 继续
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { NativeLicenseVerifier } from './native-license.verifier.js';
import { MockLicenseVerifier } from './mock-license.verifier.js';
import type { LicenseState } from './license.types.js';
import type { SelfcheckResult } from './license.types.js';

/** spec 注入用的最小接口。NativeLicenseVerifier / MockLicenseVerifier 形态都覆盖。 */
export interface LicenseVerifierLike {
  fingerprint(): string | null;
  selfcheck(): SelfcheckResult | null;
  verify(license: string, statePath: string | null): LicenseState;
}

@Injectable()
export class LicenseService {
  private readonly logger = new Logger('License');
  private state: LicenseState = {
    valid: false,
    reason: 'unchecked',
    mock: true,
    fingerprint: '',
    expiresAtMs: 0,
    daysLeft: 0,
    maxChats: 0,
  };

  private readonly isMock: boolean;
  private readonly nativeVerifier: LicenseVerifierLike;
  private readonly mockVerifier: LicenseVerifierLike;

  /** 运行期复核缓存时间戳；0 表示尚未校验 */
  private lastCheckedAt = 0;

  /** 运行期缓存 TTL（概要设计 M9：读内存缓存，TTL 1h，过期重验） */
  private static readonly CACHE_TTL_MS = 3_600_000;

  constructor(
    @Optional() nativeVerifier?: LicenseVerifierLike,
    @Optional() mockVerifier?: LicenseVerifierLike,
  ) {
    this.isMock = ConfigService.instance.USE_MOCK_LICENSE;
    // spec 可注入替换；未注入时自建
    this.nativeVerifier = nativeVerifier ?? new NativeLicenseVerifier();
    this.mockVerifier = mockVerifier ?? new MockLicenseVerifier();
  }

  /**
   * 回调路径 / health / admin 读取入口：TTL 内返回内存缓存（<1ms），
   * 过期则同步重验一次（native verify 为纯 CPU 验签，亚毫秒级）。
   */
  verifyAndCache(): LicenseState {
    if (Date.now() - this.lastCheckedAt >= LicenseService.CACHE_TTL_MS) {
      return this.revalidate();
    }
    return this.state;
  }

  /**
   * 运行期复核：只走 verify（含指纹比对/过期/回拨），不走 selfcheck、不 exit。
   * 发现证书过期或指纹变化 → valid=false，调用方进入受限模式。
   */
  revalidate(): LicenseState {
    this.state = this.doVerify();
    this.lastCheckedAt = Date.now();
    if (this.state.valid) {
      this.logger.log(
        `license-revalidate-ok daysLeft=${this.state.daysLeft}`,
      );
    } else {
      this.logger.warn(`license revalidate invalid: reason=${this.state.reason}`);
    }
    return this.state;
  }

  /** 重新走一遍完整校验并刷新缓存（POST /admin/license/reload） */
  reload(): Promise<LicenseState> {
    return this.startupCheck();
  }

  /**
   * 启动期校验。production 且 !valid → exit(1)。
   *
   * 返回 LicenseState 供测试断言；进程模式下 invalid + production 会 process.exit。
   */
  async startupCheck(): Promise<LicenseState> {
    const isProduction = process.env.NODE_ENV === 'production';

    // --- Step 1+2: fingerprint + selfcheck（仅 native 路径）---
    if (!this.isMock) {
      const native = this.nativeVerifier;
      const self = native.selfcheck();
      if (self && !self.clean) {
        this.logger.error(`license selfcheck failed: ${self.evidence.join(', ')}`);
        this.state = {
          ...this.state,
          valid: false,
          reason: 'selfcheck-failed',
          mock: false,
        };
        if (isProduction) process.exit(1);
        return this.state;
      }

      this.state = this.doVerify();
      this.lastCheckedAt = Date.now();

      if (this.state.valid) {
        this.logger.log(
          `license-ok fp=${this.state.fingerprint.slice(0, 12)} daysLeft=${this.state.daysLeft} maxChats=${this.state.maxChats}`,
        );
      } else {
        this.logger.error(`license invalid: reason=${this.state.reason}`);
      }
    } else {
      // --- mock: 跳过 selfcheck，但仍走 format + 绑定校验 ---
      this.state = this.doVerify();
      this.lastCheckedAt = Date.now();

      if (this.state.valid) {
        this.logger.log(`license-ok (mock) daysLeft=${this.state.daysLeft}`);
      } else {
        this.logger.warn(`license invalid (mock): reason=${this.state.reason}`);
      }
    }

    // --- Step 4: 终态判定 ---
    if (!this.state.valid && isProduction) {
      this.logger.error(
        `license validation failed in production: reason=${this.state.reason}, refusing to start`,
      );
      process.exit(1);
    }

    return this.state;
  }

  /** verify 单步（mock 或 native 路径，含过期/指纹/回拨比对），供启动与运行期复核共用 */
  private doVerify(): LicenseState {
    if (this.isMock) {
      const licenseRaw = this.readLicenseFile() ?? '';
      return this.mockVerifier.verify(licenseRaw, null);
    }
    const licenseRaw = this.readLicenseFile();
    const statePath = licenseRaw ? `${ConfigService.instance.LICENSE_FILE}.antireplay.json` : null;
    return this.nativeVerifier.verify(licenseRaw ?? '', statePath);
  }

  /** 供 guard / admin 查询 */
  getState(): LicenseState {
    return this.state;
  }

  private readLicenseFile(): string | null {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const raw = fs.readFileSync(ConfigService.instance.LICENSE_FILE, 'utf8');
      return raw.trim();
    } catch {
      return null;
    }
  }
}
