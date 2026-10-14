# Design: Rust 原生授权模块

## 目录结构

```
packages/license-native/
├── Cargo.toml                   # crate 名 license_native
├── build.rs                     # test profile 下生成固定测试密钥
├── src/
│   └── lib.rs                   # 4 个 #[napi] 函数 + 内嵌公钥
├── tests/
│   ├── verify.rs                # 合法/过期/篡改/错误指纹分支
│   ├── fingerprint.rs           # 跨平台 mock CPU/UUID/MAC 注入测试
│   ├── antireplay.rs            # state 文件推进/回拨/断电
│   └── selfcheck.rs             # --inspect/ptrace/LD_PRELOAD 模拟
├── test_keys/
│   ├── test_signing_key         # 测试用 Ed25519 私钥（不进 production 路径）
│   └── test_pubkey.bin          # 测试公钥
├── package.json                 # name=@cs-bot/license-native
└── prebuilds/
    └── linux-x64-gnu/
        ├── index.node
        └── README.md
```

## Cargo.toml

```toml
[package]
name = "license_native"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = { version = "2", features = ["napi4"] }
napi-derive = "2"
ed25519-dalek = { version = "2", features = ["pkcs8"] }
sha2 = "0.10"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[build-dependencies]
rand = "0.8"

[profile.release]
strip = "symbols"
lto = true
codegen-units = 1
panic = "abort"
opt-level = "z"
```

## build.rs

test profile 下生成固定密钥（确定性），debug/release 使用 `include_str!` 嵌入公钥。

```rust
use std::env;
use std::fs::File;
use std::io::Write;
use std::path::Path;

fn main() {
    if env::var("PROFILE").unwrap_or_default() == "test" {
        let mut rng = rand::thread_rng();
        let signing_key = ed25519_dalek::SigningKey::generate(&mut rng);
        let verifying_key = signing_key.verifying_key();
        
        let out_dir = env::var("OUT_DIR").unwrap();
        let dest = Path::new(&out_dir).join("test_keys.rs");
        let mut f = File::create(&dest).unwrap();
        writeln!(f, "pub const TEST_SK: [u8; 32] = {:?};", signing_key.to_bytes()).unwrap();
        writeln!(f, "pub const TEST_PK: [u8; 32] = {:?};", verifying_key.as_bytes()).unwrap();
        println!("cargo:rerun-if-changed=build.rs");
    }
}
```

## lib.rs — 4 函数签名

```rust
use napi::bindgen_prelude::*;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

#[napi(object)]
pub struct VerifyOutput {
    pub valid: bool,
    pub reason: Option<String>,
    pub expires_at_ms: i64,
    pub max_chats: i32,
}

#[napi(object)]
pub struct AntireplayOutput {
    pub ok: bool,
    pub advanced: bool,
    pub last_ts: i64,
}

#[napi(object)]
pub struct SelfcheckOutput {
    pub clean: bool,
    pub evidence: Vec<String>,
}

#[napi]
pub fn verify(payload_json: String, sig_b64: String) -> Result<VerifyOutput, napi::Error> {
    // 1. base64 decode signature
    // 2. parse payload_json → {payload, fingerprint, expiresAtMs, maxChats, ts}
    // 3. Ed25519 验签 (公钥编译期嵌入 include_str!("../test_keys/test_pubkey.bin"))
    // 4. expiresAtMs > now → 否则 valid=false, reason="expired"
    // 5. fingerprint 非空 → 否则 valid=false, reason="bad_fingerprint"
}

#[napi]
pub fn fingerprint() -> Result<String, napi::Error> {
    // SHA-256(CPU model || DMI product UUID || 主网卡 MAC || 系统盘 serial)
    // 读到 /proc/cpuinfo, /sys/class/dmi/id/product_uuid, /sys/class/net/eth0/address, lsblk
    // 失败时返回 Err，不静默返空
}

#[napi]
pub fn antireplay(state_path: String, now_ms: i64) -> Result<AntireplayOutput, napi::Error> {
    // 读 state JSON → {last_ts}
    // now_ms > last_ts → 写入 now_ms, ok=true, advanced=true
    // now_ms < last_ts → ok=false（回拨）
}

#[napi]
pub fn selfcheck() -> Result<SelfcheckOutput, napi::Error> {
    // process.debugPort != 0 / /proc/self/status.TracerPid != 0 / LD_PRELOAD 非空
    // 任一命中 → clean=false, evidence=["debugPort", "tracer", "ld_preload"] 中被触发的
}
```

## verify 函数伪代码

```
fn verify(payload_json, sig_b64):
    // R-1: Ed25519 验签
    pk = include_bytes!("../test_keys/test_pubkey.bin")  // 编译期嵌入
    sig = base64(sig_b64)
    parsed = serde_json::from_str(payload_json)
    
    // 验签前须确保 payload 未篡改
    if pk.verify(payload_json.as_bytes(), sig).is_err():
        return {valid: false, reason: "bad_signature", ...}
    
    // R-2: 时间有效性
    now = SystemTime::now().as_millis()
    if parsed.expiresAtMs < now:
        return {valid: false, reason: "expired", ...}
    
    // R-3: 指纹非空
    if parsed.fingerprint.is_empty():
        return {valid: false, reason: "bad_fingerprint", ...}
    
    return {valid: true, reason: None, expiresAtMs, maxChats}
```

## fingerprint 函数逻辑

```
fn fingerprint():
    cpu_model = read_file("/proc/cpuinfo") → grep "model name" → 第一个值
    uuid = read_file("/sys/class/dmi/id/product_uuid") → trim
    mac = read_file("/sys/class/net/eth0/address") → trim
    serial = exec("lsblk -d -o SERIAL -n | head -1") → trim
    raw = format!("{}|{}|{}|{}", cpu_model, uuid, mac, serial)
    return sha256(raw)
```

## antireplay 函数逻辑

```
fn antireplay(state_path, now_ms):
    if !file_exists(state_path):
        write_json(state_path, {last_ts: 0})
    
    state = read_json(state_path)
    if now_ms < state.last_ts:
        return {ok: false, advanced: false, last_ts: state.last_ts}
    
    write_json(state_path, {last_ts: now_ms})
    return {ok: true, advanced: now_ms > state.last_ts, last_ts: now_ms}
```

## selfcheck 函数逻辑

```
fn selfcheck():
    evidence = []
    
    // debugPort 检测
    if process.debugPort != 0 || find "debugger" in /proc/self/status:
        evidence.push("debugPort")
    
    // tracer 检测
    status = read_file("/proc/self/status")
    if status.TracerPid != "0":
        evidence.push("tracer")
    
    // LD_PRELOAD 检测
    if env("LD_PRELOAD").is_some() or env("LD_LIBRARY_PRELOAD").is_some():
        evidence.push("ld_preload")
    
    return {clean: evidence.is_empty(), evidence}
```

## 测试策略

Rust 单元测试（`cargo test`）覆盖：
- `verify.rs`: 合法 payload + 正确签名 / 篡改签名 / 过期时间 / 空指纹
- `fingerprint.rs`: 注入 mock /proc/cpuinfo 等文件
- `antireplay.rs`: 新 state 创建 / 推进 / 回拨 / 断电恢复
- `selfcheck.rs`: clean 路径 / debugPort 注入 / tracer 注入 / LD_PRELOAD 注入

生产路径不读取 `test_keys/` 目录；仅 Rust `tests/` + build.rs test profile 读取。

## package.json

```json
{
  "name": "@cs-bot/license-native",
  "version": "0.1.0",
  "type": "module",
  "main": "./prebuilds/linux-x64-gnu/index.node",
  "files": ["prebuilds/"],
  "scripts": {
    "build": "napi build --platform linux --arch x64 --strip",
    "build:test": "cargo test"
  }
}
```

## prebuilds 生成

```bash
napi build --platform linux --arch x64 --target x86_64-unknown-linux-gnu --strip
# 产物: prebuilds/linux-x64-gnu/index.node
```

## Spec 增量 (合入 license-skeleton)

新增 requirement 到 `openspec/specs/license-skeleton/spec.md`:

### Requirement: M9 Native Core

The system MUST provide a native Rust module (N-API) implementing Ed25519 license verification,
machine fingerprint collection, anti-replay protection, and tamper detection. The TypeScript layer
MUST NOT implement any of these cryptographic or OS-level operations. SHA-3.1.7

#### Scenario: N-API verify function
- WHEN license file and signature are provided
- THEN the Rust module MUST verify the Ed25519 signature against the embedded public key
- AND MUST reject expired, tampered, or fingerprint-less payloads with a reason code

#### Scenario: N-API fingerprint function
- WHEN called on a Linux host
- THEN the module MUST collect CPU model, DMI UUID, primary MAC, and disk serial
- AND MUST return SHA-256 of the concatenated values

#### Scenario: N-API antireplay function
- WHEN called with a timestamp older than the last recorded timestamp
- THEN the module MUST reject with ok=false (replay protection)
- AND MUST persist the new timestamp on advancement

#### Scenario: N-API selfcheck function
- WHEN called
- THEN the module MUST detect debugger attachment, ptrace tracing, and LD_PRELOAD
- AND MUST return a list of triggered evidence
