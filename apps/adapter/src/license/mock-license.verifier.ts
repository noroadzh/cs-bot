/**
 * Mock mode license verifier
 *
 * Mock 只 stub 验签（不验签），保留 format + payload parse + 过期 + fingerprint 绑定校验。
 * 语义见 change B: mock 不再"永远 valid:true"，而是真的 parse 一次 license。
 *
 * 依赖 packages/license-native 的 fingerprint()（容错：失败跳过绑定，仅 warn）。
 */
import { createRequire } from 'node:module';
import type { LicenseState } from './license.types.js';

const require = createRequire(import.meta.url);

let fingerprintOfHost: string | null = null;
try {
  const native = require('@cs-bot/license-native') as typeof import('@cs-bot/license-native');
  try {
    fingerprintOfHost = native.fingerprint();
  } catch {
    fingerprintOfHost = null;
  }
} catch {
  fingerprintOfHost = null;
}

export class MockLicenseVerifier {
  private readonly expectedFingerprint: string | null;

  constructor() {
    this.expectedFingerprint = fingerprintOfHost;
  }

  verify(license: string): LicenseState {
    const fallback: LicenseState = {
      valid: false,
      reason: 'mock-no-license',
      mock: true,
      fingerprint: '',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    };

    if (!license || license.trim() === '') {
      return fallback;
    }

    // 1. 格式：必须正好两段 `<b64payload>.<b64sig>`
    const parts = license.trim().split('.');
    if (parts.length !== 2) {
      return { ...fallback, reason: 'malformed' };
    }

    // 2. payload 解析
    let payload: { fingerprint?: string; expiresAtMs?: number; maxChats?: number };
    try {
      const decoded = Buffer.from(parts[0], 'base64').toString('utf8');
      payload = JSON.parse(decoded);
    } catch {
      return { ...fallback, reason: 'malformed' };
    }

    // 3. 过期检查
    const expiresAtMs = Number(payload.expiresAtMs ?? 0);
    const now = Date.now();
    const daysLeft = Math.floor((expiresAtMs - now) / 86_400_000);
    const baseState: LicenseState = {
      valid: daysLeft >= 0,
      reason: daysLeft >= 0 ? 'valid' : 'expired',
      mock: true,
      fingerprint: payload.fingerprint ?? '',
      expiresAtMs,
      daysLeft,
      maxChats: Number(payload.maxChats ?? 0),
    };

    if (!baseState.valid) {
      return baseState;
    }

    // 4. fingerprint 绑定（容错：expectedFingerprint 为 null 时跳过）
    const fp = payload.fingerprint ?? '';
    if (this.expectedFingerprint !== null && fp !== '' && fp !== this.expectedFingerprint) {
      return { ...baseState, valid: false, reason: 'fingerprint-mismatch' };
    }

    return baseState;
  }
}