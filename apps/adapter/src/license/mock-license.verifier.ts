/**
 * MockLicenseVerifier
 * - 文件不存在：warn + 返回 mock valid
 * - 格式错误：warn + 返回 mock malformed
 * - 正确格式：解析 payload，返回 mock valid + parsed expiresAt
 * 不验签（签名验证在 NativeLicenseVerifier 中实现）
 */
import { readFileSync, existsSync } from 'fs';
import { ConfigService } from '../config/config.service.js';
import { ILicenseVerifier, type LicenseState } from './license.types.js';
import { AppLogger } from '../common/logger.js';

export class MockLicenseVerifier implements ILicenseVerifier {
  private readonly logger = new AppLogger('MockLicenseVerifier');
  private readonly licenseFile: string;

  constructor(_config: ConfigService) {
    this.licenseFile = ConfigService.instance.LICENSE_FILE;
  }

  async verify(): Promise<LicenseState> {
    if (!existsSync(this.licenseFile)) {
      this.logger.warn({ detail: 'license-file-not-found', path: this.licenseFile });
      return { valid: true, reason: 'mock', mock: true };
    }

    try {
      const raw = readFileSync(this.licenseFile, 'utf8').trim();
      // 格式：base64payload.base64sig
      const parts = raw.split('.');
      if (parts.length !== 2) {
        this.logger.warn({ detail: 'license-malformed', reason: 'invalid-format' });
        return { valid: true, reason: 'malformed', mock: true };
      }

      // 解码 payload（JSON）
      const payloadStr = Buffer.from(parts[0], 'base64').toString('utf8');
      const payload = JSON.parse(payloadStr);

      const expiresAt = payload.expiresAt ?? payload.exp ?? '';
      const maxChats = payload.maxChats ?? payload.seats ?? 999;
      const fingerprint = payload.fingerprint ?? payload.deviceId ?? '';

      // 简单检查是否过期（mock 模式下永远返回 valid）
      if (expiresAt && new Date(expiresAt) < new Date()) {
        return { valid: true, reason: 'expired', expiresAt, maxChats, fingerprint, mock: true };
      }

      const daysLeft = expiresAt
        ? Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)
        : undefined;

      return { valid: true, reason: 'valid', expiresAt, daysLeft, maxChats, fingerprint, mock: true };
    } catch (err) {
      this.logger.warn({ detail: 'license-parse-error', err: (err as Error).message });
      return { valid: true, reason: 'malformed', mock: true };
    }
  }
}
