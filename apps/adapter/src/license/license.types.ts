/**
 * License 校验类型定义
 *
 * 由 native / mock 两个 verifier 的实际返回形态决定，reason 取值来自：
 *   - native: 'valid' | 'bad-format' | 'bad-payload' | 'bad-signature' | 'expired'
 *            | 'empty-fingerprint' | 'fingerprint-mismatch' | 'antireplay-failure'
 *            | 'native-not-loaded' | 'native-error' | 'selfcheck-failed'
 *   - mock:   'valid' | 'expired' | 'malformed' | 'mock-no-license'
 *            | 'fingerprint-mismatch'
 *   - service: 'unchecked' | 'selfcheck-failed'
 *
 * 注意：变更原因字符串是诊断信息，不是状态机；调用方应按 valid 布尔判断，
 * 不要 switch(reason) 做穷举。
 */
export interface LicenseState {
  /** 校验是否通过（含绑定与反回放） */
  valid: boolean
  /** 诊断原因；'valid' 表示全部通过 */
  reason: string
  /** 是否 mock 模式校验 */
  mock: boolean
  /** license 中绑定的机器指纹；mock 无绑定时为 '' */
  fingerprint: string
  /** 过期时间（Unix ms）；无信息时 0 */
  expiresAtMs: number
  /** 剩余天数；已过期为负 */
  daysLeft: number
  /** 授权群数量上限 */
  maxChats: number
}

/** selfcheck 探测结果：clean=true 表示无调试/劫持痕迹 */
export interface SelfcheckResult {
  clean: boolean
  /** 不干净时的证据条目（如 'debugger-detected' / 'tracerpid-hit'） */
  evidence: string[]
}

/** 供 guard / admin 查询的只读视图 */
export interface ILicenseVerifier {
  verify(license: string, statePath?: string | null): LicenseState
}