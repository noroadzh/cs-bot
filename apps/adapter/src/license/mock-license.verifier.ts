/**
 * Mock mode license verifier
 *
 * Mock 只 stub 验签（不验签），保留 format + payload parse + 过期 + fingerprint 绑定校验。
 * 语义见 change B: mock 不再"永远 valid:true"，而是真的 parse 一次 license。
 *
 * 依赖 packages/license-native 的 fingerprint()（容错：失败跳过绑定，仅 warn）。
 */
import { createRequire } from 'node:module';
import type { LicenseState, SelfcheckResult } from './license.types.js';

const nodeRequire: NodeRequire =
  typeof require === 'function' ? require : createRequire(process.cwd() + '/');

let fingerprintOfHost: string | null = null;
try {
  const native = nodeRequire('@cs-bot/license-native') as typeof import('@cs-bot/license-native');
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

  /**
   * mock 模式不做启动期反调试自检，返回 null（LicenseService 视作"无自检"）。
   */
  selfcheck(): SelfcheckResult | null {
    return null;
  }

  /** 兼容 LicenseVerifierLike 接口：本机指纹，失败为 null */
  fingerprint(): string | null {
    return this.expectedFingerprint;
  }

  /**
   * mock 模式不跑 native 签名与反回放，`_statePath` 仅用于满足统一签名。
   */
  verify(license?: string, _statePath?: string | null): LicenseState {
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

    // 3. 过期检查（expiresAtMs 缺失 → malformed，避免静默当成 1970）
    const expiresAtMsRaw = payload.expiresAtMs;
    if (typeof expiresAtMsRaw !== 'number' || !Number.isFinite(expiresAtMsRaw)) {
      return { ...fallback, reason: 'malformed' };
    }
    const expiresAtMs = expiresAtMsRaw;
    const now = Date.now();
    // 向零截断：过期 1 天内 daysLeft=-1 而非 -2
    const daysLeft = Math.trunc((expiresAtMs - now) / 86_400_000);
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