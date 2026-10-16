/**
 * Native Ed25519 + 机器绑定 license 校验器
 *
 * 依赖 packages/license-native 的 N-API 产物（index.node）。
 * 启动序（见 license.service.ts:startupCheck）：
 *   1. fingerprint()        → expectedFingerprint
 *   2. selfcheck()          → clean:false 时按 B.5 直接 exit
 *   3. verify(license)      → Ed25519 + 过期
 *   4. fingerprint 比对     → 不一致则 valid:false reason:'fingerprint-mismatch'
 *   5. antireplay()         → 时间回拨防御
 */
import { createRequire } from 'node:module';
import type {
  VerifyResult,
  AntireplayResult,
  SelfcheckResult,
} from '@cs-bot/license-native';
import type { LicenseState } from './license.types.js';

// 生产（NodeNext → ESM）无全局 require，用 createRequire 以 cwd 锚点解析；
// ts-jest 以 commonjs 转译，此时 import.meta 是编译错误，故不能直接用 import.meta.url。
// 包名解析走 node_modules 向上查找，cwd 锚点与模块自身路径锚点等效（WORKDIR=/app）。
const nodeRequire: NodeRequire =
  typeof require === 'function'
    ? require
    : createRequire(process.cwd() + '/');

/** N-API 模块可能加载失败时回退；这种回退禁止掩盖 startupCheck 的预期错误。 */
let native: typeof import('@cs-bot/license-native') | null = null;
try {
  native = nodeRequire('@cs-bot/license-native') as typeof import('@cs-bot/license-native');
} catch (err) {
  // 故意吞掉，verify() 时再以 mock-no-license 形态上报
  // （生产模式 startupCheck 会视情况 exit）
  native = null;
}

export class NativeLicenseVerifier {
  private readonly expectedFingerprint: string | null;

  constructor() {
    if (!native) {
      this.expectedFingerprint = null;
      return;
    }
    try {
      this.expectedFingerprint = native.fingerprint();
    } catch (err) {
      // 非 Linux 平台会抛；视为"无法绑定"
      this.expectedFingerprint = null;
    }
  }

  /**
   * 启动期反调试自检。命中 evidence 时调用方应 exit(1)。
   */
  selfcheck(): SelfcheckResult | null {
    if (!native) return null;
    try {
      return native.selfcheck();
    } catch {
      return null;
    }
  }

  /**
   * 启动期取得本机指纹。失败返回 null（后续绑定跳过）。
   */
  getFingerprint(): string | null {
    return this.expectedFingerprint;
  }

  /** 兼容 LicenseVerifierLike 接口 */
  fingerprint(): string | null {
    return this.expectedFingerprint;
  }

  /**
   * 校验 license.lic 内容，附 fingerprint 绑定检查。
   * @param license `<base64payload>.<base64sig>` 字符串
   * @param statePath antireplay 状态文件路径；null 时跳过反回放
   */
  verify(license: string, statePath: string | null): LicenseState {
    const fallback: LicenseState = {
      valid: false,
      reason: 'native-not-loaded',
      mock: false,
      fingerprint: this.expectedFingerprint ?? '',
      expiresAtMs: 0,
      daysLeft: 0,
      maxChats: 0,
    };

    if (!native) {
      return { ...fallback, reason: 'native-not-loaded' };
    }

    // 1. native verify (双参数：payload JSON + base64 sig)
    const dotIdx = license.indexOf('.');
    if (dotIdx <= 0 || dotIdx === license.length - 1) {
      return { ...fallback, reason: 'bad-format' };
    }
    const payloadB64 = license.slice(0, dotIdx);
    const sigB64 = license.slice(dotIdx + 1);
    // 先 base64 decode payload 再还原 JSON 给 native（native 内部不做 base64 decode）
    let payloadJson: string;
    try {
      payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    } catch {
      return { ...fallback, reason: 'bad-format' };
    }
    let raw: VerifyResult;
    try {
      // Rust verify(payload_json: String, sig_b64: String)
      raw = native.verify(payloadJson, sigB64);
    } catch (err) {
      return { ...fallback, reason: 'native-error' };
    }

    const baseState: LicenseState = {
      valid: raw.valid,
      reason: raw.reason,
      mock: false,
      fingerprint: raw.fingerprint ?? this.expectedFingerprint ?? '',
      expiresAtMs: raw.expiresAtMs ?? 0,
      daysLeft: raw.daysLeft ?? 0,
      maxChats: raw.maxChats ?? 0,
    };

    if (!raw.valid) {
      return baseState;
    }

    // 2. fingerprint 绑定
    if (
      this.expectedFingerprint !== null &&
      raw.fingerprint !== '' &&
      raw.fingerprint !== this.expectedFingerprint
    ) {
      return { ...baseState, valid: false, reason: 'fingerprint-mismatch' };
    }

    // 3. 反回放
    if (statePath !== null) {
      let ar: AntireplayResult;
      try {
        ar = native.antireplay(statePath, Date.now());
      } catch {
        return { ...baseState, valid: false, reason: 'antireplay-failure' };
      }
      if (!ar.ok) {
        return { ...baseState, valid: false, reason: 'antireplay-failure' };
      }
    }

    return baseState;
  }
}
