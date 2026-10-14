/**
 * Rust N-API 模块类型声明（自动生成的手写等价物）
 *
 * 由 packages/license-native/src/lib.rs 的 #[napi] 函数签名对应而来。
 * 真实产物由 cargo/napi 生成，此文件保证 adapter 侧在未跑 build 时仍能通过 tsc。
 */

export interface VerifyOk {
  /** 验签与过期检查均通过 */
  valid: true
  /** 恒为 'valid' */
  reason: string
  /** 绑定的机器指纹，hex */
  fingerprint: string
  /** 过期时间（Unix ms） */
  expiresAtMs: number
  /** 剩余天数，已过期为负 */
  daysLeft: number
  /** 授权群数量上限 */
  maxChats: number
}

export interface VerifyErr {
  valid: false
  /** 'bad-format' | 'bad-payload' | 'bad-signature' | 'expired' | 'empty-fingerprint' | 'not-embedded' | 'native-error' */
  reason: string
  fingerprint: string
  expiresAtMs: number
  daysLeft: number
  maxChats: number
}

export type VerifyResult = VerifyOk | VerifyErr

export interface AntireplayResult {
  /** true = 通过；false = 状态回拨或文件损坏 */
  ok: boolean
  /** 本次是否推进了时间戳 */
  advanced: boolean
  /** 状态文件中的上次时间戳，文件不存在时为 0 */
  lastTs: number
}

export interface SelfcheckResult {
  /** 无异常信号时为 true */
  clean: boolean
  /** 命中的检测项，例如 ['debugPort', 'tracerPid', 'ldPreload'] */
  evidence: string[]
}

/**
 * 验签一段 license。
 *
 * 校验顺序：base64 sig 解码 → sig 长度 64 → payload JSON 解析
 *           → Ed25519 签名（编译期内嵌公钥）→ 过期 → 空指纹。
 * 不做机器指纹绑定（那是调用方 NativeLicenseVerifier 的职责）。
 *
 * @param payloadJson license payload 的 JSON 文本
 *                     （字段：payload / fingerprint / expires_at_ms / max_chats / ts）
 * @param sigB64      Base64 编码的 Ed25519 签名（64 字节）
 */
export declare function verify(payloadJson: string, sigB64: string): VerifyResult

/**
 * 采集本机硬件指纹：cpu model + dmi product_uuid + 网卡 MAC + 磁盘 serial。
 *
 * Linux-only 读取路径；非 Linux 平台会抛 `GenericFailure`（A.7/A.8 未出 Linux 产物前的已知限制）。
 */
export declare function fingerprint(): string

/**
 * 反回放：以 statePath 为状态文件推进时间戳。
 *
 * 若传入的 now 小于等于上次记录，返回 ok:false（疑似时间回拨/重复使用），不写文件。
 */
export declare function antireplay(statePath: string, now: number): AntireplayResult

/**
 * 反调试自检：检测 debugPort(9229) / TracerPid / LD_PRELOAD。
 * 命中任一项时 clean:false 并在 evidence 中给出项名。
 */
export declare function selfcheck(): SelfcheckResult