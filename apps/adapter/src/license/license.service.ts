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
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { NativeLicenseVerifier } from './native-license.verifier.js';
import { MockLicenseVerifier } from './mock-license.verifier.js';
import type { LicenseState } from './license.types.js';

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

  constructor(private readonly config: ConfigService) {
    this.isMock = this.config.USE_MOCK_LICENSE;
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
      const native = new NativeLicenseVerifier();
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

      // --- Step 3: verify ---
      const licenseRaw = this.readLicenseFile();
      const statePath = licenseRaw ? `${this.config.LICENSE_FILE}.antireplay.json` : null;
      const nativeState = native.verify(licenseRaw ?? '', statePath);
      this.state = nativeState;

      if (nativeState.valid) {
        this.logger.log(
          `license-ok fp=${nativeState.fingerprint.slice(0, 12)} daysLeft=${nativeState.daysLeft} maxChats=${nativeState.maxChats}`,
        );
      } else {
        this.logger.error(`license invalid: reason=${nativeState.reason}`);
      }
    } else {
      // --- mock: 跳过 selfcheck，但仍走 format + 绑定校验 ---
      const mock = new MockLicenseVerifier();
      const licenseRaw = this.readLicenseFile() ?? '';
      this.state = mock.verify(licenseRaw);

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

  /** 供 guard / admin 查询 */
  getState(): LicenseState {
    return this.state;
  }

  private readLicenseFile(): string | null {
    try {
      const fs = require('node:fs') as typeof import('node:fs');
      const raw = fs.readFileSync(this.config.LICENSE_FILE, 'utf8');
      return raw.trim();
    } catch {
      return null;
    }
  }
}
