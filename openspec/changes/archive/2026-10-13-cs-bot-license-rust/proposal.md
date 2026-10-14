# Change: Rust 原生授权模块

## Why

M9 授权闸门核心（Ed25519 验签、指纹采集、时间回拨防护、反调试检测）按概设 L228 与详设 L134 必须**不在 JS 层落地**。当前 `apps/adapter/src/license/native-license.verifier.ts` 类名带 "native" 但内部是纯 JS，**不是 Rust**。`packages/license-native/` 是空壳（无 Cargo.toml、无 .rs、无 prebuilds）。客户对"授权"一词的合同承诺是 M9，**当前实现未达成此承诺**。

## What changes

- 新增 `packages/license-native/` Rust 工程，导出 4 个 N-API 函数：`verify` / `fingerprint` / `antireplay` / `selfcheck`
- 内嵌 Ed25519 公钥与 fingerprint 算法；strip 符号表
- 预编译 `index.linux-x64-gnu.node` 至 `packages/license-native/prebuilds/`
- 单元测试覆盖：合法/过期/篡改签名/错误指纹/回拨/replay/inspect 检测

## Non-goals

- 不动 TS 侧 `NativeLicenseVerifier`（在 change B）
- 不动 Dockerfile（change C）
- 不做 sign 工具本体（change C 的 `tools/license-issuer`）
- 不做启动强校验（change B）