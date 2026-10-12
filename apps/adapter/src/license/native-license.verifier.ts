/**
 * NativeLicenseVerifier 占位实现
 * 在 packages/license-native/prebuilds 未就绪时返回 native-placeholder 状态
 */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service.js';
import { AppLogger } from '../common/logger.js';
import { ILicenseVerifier, type LicenseState } from './license.types.js';

@Injectable()
export class NativeLicenseVerifier implements ILicenseVerifier {
  private readonly logger = new AppLogger('NativeLicenseVerifier');

  constructor(_config: ConfigService) {
    this.logger.warn({ detail: 'native-license-placeholder', reason: 'prebuild-not-loaded' });
  }

  async verify(): Promise<LicenseState> {
    return {
      valid: true,
      reason: 'native-placeholder',
      mock: false,
    };
  }
}
