/**
 * Rust Native License Module - M9 授权核心
 *
 * 导出 4 个 N-API 函数：
 * - verify: Ed25519 签名验证
 * - fingerprint: 机器指纹采集
 * - antireplay: 防重放时间戳
 * - selfcheck: 反调试检测
 */

use napi::bindgen_prelude::*;
use napi_derive::napi;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Sha256, Digest};
use std::fs;
use std::path::Path;
use std::process::Command;

// ==================== Types ====================

#[derive(Serialize, Deserialize)]
struct LicensePayload {
    payload: String,
    fingerprint: String,
    expires_at_ms: i64,
    max_chats: i32,
    ts: i64,
}

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

// ==================== Build-time embedded public key ====================

// 生产构建时嵌入真实公钥（由部署流程注入到 src/pubkey.bin）
// 测试时使用 test_keys/test_pubkey.bin
#[cfg(test)]
const EMBEDDED_PK: &[u8; 32] = include_bytes!("../test_keys/test_pubkey.bin");

#[cfg(not(test))]
const EMBEDDED_PK: &[u8; 32] = include_bytes!("../src/pubkey.bin");

// ==================== verify ====================

/// 验证 Ed25519 签名
///
/// # Arguments
/// * `payload_json` - JSON 序列化 { payload, fingerprint, expiresAtMs, maxChats, ts }
/// * `sig_b64` - Base64 编码的 Ed25519 签名
#[napi]
pub fn verify(payload_json: String, sig_b64: String) -> napi::Result<VerifyOutput> {
    // 1. Base64 解码签名
    use base64::Engine;
    let sig_bytes = base64::engine::general_purpose::STANDARD
        .decode(&sig_b64)
        .map_err(|e| napi::Error::new(napi::Status::InvalidArg, format!("invalid base64 signature: {}", e)))?;

    if sig_bytes.len() != 64 {
        return Ok(VerifyOutput {
            valid: false,
            reason: Some("invalid_signature_length".to_string()),
            expires_at_ms: 0,
            max_chats: 0,
        });
    }

    let signature = Signature::from_slice(&sig_bytes)
        .map_err(|e| napi::Error::new(napi::Status::InvalidArg, format!("invalid signature: {}", e)))?;

    // 2. 解析 payload
    let payload: LicensePayload = match serde_json::from_str(&payload_json) {
        Ok(p) => p,
        Err(e) => {
            return Ok(VerifyOutput {
                valid: false,
                reason: Some(format!("invalid payload json: {}", e)),
                expires_at_ms: 0,
                max_chats: 0,
            });
        }
    };

    // 3. Ed25519 验签
    let pk = VerifyingKey::from_bytes(EMBEDDED_PK)
        .map_err(|e| napi::Error::new(napi::Status::InvalidArg, format!("invalid public key: {}", e)))?;

    if pk.verify(payload_json.as_bytes(), &signature).is_err() {
        return Ok(VerifyOutput {
            valid: false,
            reason: Some("bad_signature".to_string()),
            expires_at_ms: payload.expires_at_ms,
            max_chats: payload.max_chats,
        });
    }

    // 4. 检查过期
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64;

    if payload.expires_at_ms < now {
        return Ok(VerifyOutput {
            valid: false,
            reason: Some("expired".to_string()),
            expires_at_ms: payload.expires_at_ms,
            max_chats: payload.max_chats,
        });
    }

    // 5. 检查指纹非空
    if payload.fingerprint.is_empty() {
        return Ok(VerifyOutput {
            valid: false,
            reason: Some("bad_fingerprint".to_string()),
            expires_at_ms: payload.expires_at_ms,
            max_chats: payload.max_chats,
        });
    }

    // 6. 检查时间戳非空
    if payload.ts == 0 {
        return Ok(VerifyOutput {
            valid: false,
            reason: Some("invalid_timestamp".to_string()),
            expires_at_ms: payload.expires_at_ms,
            max_chats: payload.max_chats,
        });
    }

    Ok(VerifyOutput {
        valid: true,
        reason: None,
        expires_at_ms: payload.expires_at_ms,
        max_chats: payload.max_chats,
    })
}

// ==================== fingerprint ====================

/// 采集机器指纹
///
/// SHA-256(CPU model || DMI product UUID || 主网卡 MAC || 系统盘 serial)
#[napi]
pub fn fingerprint() -> napi::Result<String> {
    let cpu_model = read_cpu_model().map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;
    let uuid = read_dmi_uuid().map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;
    let mac = read_primary_mac().map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;
    let serial = read_disk_serial().map_err(|e| napi::Error::new(napi::Status::GenericFailure, e))?;

    let raw = format!("{}|{}|{}|{}", cpu_model, uuid, mac, serial);
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let result = hasher.finalize();

    Ok(hex::encode(result))
}

fn read_cpu_model() -> Result<String> {
    let content = fs::read_to_string("/proc/cpuinfo")
        .map_err(|e| napi::Error::from_reason(format!("read /proc/cpuinfo: {}", e)))?;

    for line in content.lines() {
        if line.starts_with("model name") {
            if let Some((_, v)) = line.split_once(':') {
                return Ok(v.trim().to_string());
            }
        }
    }
    Err(napi::Error::from_reason("cpu_model not found in /proc/cpuinfo"))
}

fn read_dmi_uuid() -> Result<String> {
    let content = fs::read_to_string("/sys/class/dmi/id/product_uuid")
        .map_err(|e| napi::Error::from_reason(format!("read product_uuid: {}", e)))?;
    Ok(content.trim().to_string())
}

fn read_primary_mac() -> Result<String> {
    // 尝试 eth0, ens, enp 等常见网卡名
    let candidates = ["eth0", "ens33", "enp0s3", "enp0s8"];

    for name in candidates {
        let path = format!("/sys/class/net/{}/address", name);
        if let Ok(content) = fs::read_to_string(&path) {
            return Ok(content.trim().to_lowercase());
        }
    }

    // 枚举所有网卡
    if let Ok(entries) = fs::read_dir("/sys/class/net") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "lo" { continue; }
            let path = format!("/sys/class/net/{}/address", name);
            if let Ok(content) = fs::read_to_string(&path) {
                let mac = content.trim();
                if !mac.is_empty() && mac != "00:00:00:00:00:00" {
                    return Ok(mac.to_lowercase());
                }
            }
        }
    }

    Err(napi::Error::from_reason("no valid network interface found"))
}

fn read_disk_serial() -> Result<String> {
    let output = Command::new("lsblk")
        .args(["-d", "-o", "SERIAL", "-n"])
        .output()
        .map_err(|e| napi::Error::from_reason(format!("exec lsblk: {}", e)))?;

    if !output.status.success() {
        return Err(napi::Error::from_reason("lsblk command failed"));
    }

    let serial = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    if serial.is_empty() {
        return Err(napi::Error::from_reason("disk serial is empty"));
    }

    Ok(serial)
}

// ==================== antireplay ====================

/// 防重放时间戳
///
/// # Arguments
/// * `state_path` - 状态文件路径
/// * `now_ms` - 当前时间戳（毫秒）
#[napi]
pub fn antireplay(state_path: String, now_ms: i64) -> napi::Result<AntireplayOutput> {
    let path = Path::new(&state_path);

    // 1. 读取或创建 state
    // 注意：state 文件损坏时按「视为新安装」处理（last_ts=0），
    // 而不是让授权检查整体失败——否则一个损坏文件就能让客户彻底无法启动。
    let last_ts = if path.exists() {
        let last_ts = match fs::read_to_string(path) {
            Ok(content) => serde_json::from_str::<serde_json::Value>(&content)
                .ok()
                .and_then(|state| state.get("last_ts").and_then(|v| v.as_i64()))
                .unwrap_or(0),
            Err(e) => {
                return Err(napi::Error::new(
                    napi::Status::GenericFailure,
                    format!("read state: {}", e),
                ));
            }
        };
        last_ts
    } else {
        // 首次创建
        let parent = path.parent().ok_or_else(||
            napi::Error::new(napi::Status::InvalidArg, "invalid state path".to_string()))?;
        fs::create_dir_all(parent)
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("mkdir: {}", e)))?;
        0
    };

    // 2. 检测回拨
    if now_ms < last_ts {
        return Ok(AntireplayOutput {
            ok: false,
            advanced: false,
            last_ts,
        });
    }

    // 3. 推进并写入
    let advanced = now_ms > last_ts;
    let new_state = serde_json::json!({ "last_ts": now_ms });
    let new_content = serde_json::to_string_pretty(&new_state)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("serialize state: {}", e)))?;

    fs::write(path, &new_content)
        .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("write state: {}", e)))?;

    // 设置文件权限 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms)
            .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("chmod: {}", e)))?;
    }

    Ok(AntireplayOutput {
        ok: true,
        advanced,
        last_ts: now_ms,
    })
}

// ==================== selfcheck ====================

/// 反调试检测
///
/// 检测 debugger、ptrace、LD_PRELOAD
#[napi]
pub fn selfcheck() -> napi::Result<SelfcheckOutput> {
    let mut evidence = Vec::new();

    // 1. debugPort 检测
    // 通过检查 /proc/self/status 中的 TracerPid
    if let Ok(content) = fs::read_to_string("/proc/self/status") {
        for line in content.lines() {
            if line.starts_with("TracerPid:") {
                let pid = line.split_whitespace().nth(1).unwrap_or("0");
                if pid != "0" {
                    evidence.push("tracer".to_string());
                }
                break;
            }
        }
    }

    // 2. 检查 DEBUG_PORT 环境变量
    if std::env::var("DEBUG_PORT").is_ok() || std::env::var("NODE_OPTIONS").is_ok() {
        let opts = std::env::var("NODE_OPTIONS").unwrap_or_default();
        if opts.contains("--inspect") || opts.contains("--debug") {
            evidence.push("debugPort".to_string());
        }
    }

    // 3. LD_PRELOAD 检测
    if std::env::var("LD_PRELOAD").is_ok() {
        evidence.push("ld_preload".to_string());
    }
    if std::env::var("LD_LIBRARY_PRELOAD").is_ok() {
        evidence.push("ld_library_preload".to_string());
    }

    Ok(SelfcheckOutput {
        clean: evidence.is_empty(),
        evidence,
    })
}

// ==================== Tests ====================

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use ed25519_dalek::{Signer, SigningKey};
    use tempfile::TempDir;

    // 测试用密钥（硬编码测试向量，与 test_keys/test_signing_key 匹配）
    fn test_signing_key() -> SigningKey {
        let sk_bytes: [u8; 32] = [
            0x9a, 0x0f, 0xab, 0x36, 0x10, 0xca, 0x06, 0x8f,
            0x3c, 0x83, 0x72, 0xf2, 0x1b, 0x84, 0x3e, 0x62,
            0x0f, 0x25, 0x0e, 0xc9, 0x3a, 0x1d, 0x4e, 0x7f,
            0x5c, 0x4e, 0x36, 0x15, 0x5d, 0x7f, 0x6e, 0x2d,
        ];
        SigningKey::from_bytes(&sk_bytes)
    }

    #[allow(dead_code)]
    fn test_verifying_key() -> VerifyingKey {
        test_signing_key().verifying_key()
    }

    // ========== verify tests ==========

    #[test]
    fn test_verify_valid_signature() {
        let sk = test_signing_key();
        let payload = serde_json::json!({
            "payload": "test-license-data",
            "fingerprint": "fp-123456",
            "expires_at_ms": 9999999999999i64,
            "max_chats": 1000,
            "ts": 1700000000000i64
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        let signature = sk.sign(payload_json.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

        let result = verify(payload_json, sig_b64).unwrap();
        assert!(result.valid, "Valid signature should pass");
        assert!(result.reason.is_none());
        assert_eq!(result.max_chats, 1000);
        assert_eq!(result.expires_at_ms, 9999999999999i64);
    }

    #[test]
    fn test_verify_tampered_signature() {
        let sk = test_signing_key();
        let payload = serde_json::json!({
            "payload": "test-license-data",
            "fingerprint": "fp-123456",
            "expires_at_ms": 9999999999999i64,
            "max_chats": 1000,
            "ts": 1700000000000i64
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        let signature = sk.sign(payload_json.as_bytes());

        // Tamper with signature: decode → flip a middle byte → re-encode
        // 这样保持 64 字节长度，确保命中的是验签分支而非 length 检查
        let mut sig_bytes = signature.to_bytes();
        sig_bytes[32] ^= 0xFF;
        let tampered_sig_b64 = base64::engine::general_purpose::STANDARD.encode(&sig_bytes);

        let result = verify(payload_json, tampered_sig_b64).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("bad_signature"));
    }

    #[test]
    fn test_verify_expired() {
        let sk = test_signing_key();
        let payload = serde_json::json!({
            "payload": "test-license-data",
            "fingerprint": "fp-123456",
            "expires_at_ms": 1000i64, // 1970-01-01 00:00:01 - expired
            "max_chats": 1000,
            "ts": 1700000000000i64
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        let signature = sk.sign(payload_json.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

        let result = verify(payload_json, sig_b64).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("expired"));
    }

    #[test]
    fn test_verify_bad_payload_json() {
        // 必须用合法长度的签名（64 字节），否则会先命中 length 检查
        let valid_sig = base64::engine::general_purpose::STANDARD
            .encode([0u8; 64]);
        let result = verify("not valid json".to_string(), valid_sig).unwrap();
        assert!(!result.valid);
        assert!(result.reason.unwrap().contains("invalid payload json"));
    }

    #[test]
    fn test_verify_empty_fingerprint() {
        let sk = test_signing_key();
        let payload = serde_json::json!({
            "payload": "test-license-data",
            "fingerprint": "", // empty
            "expires_at_ms": 9999999999999i64,
            "max_chats": 1000,
            "ts": 1700000000000i64
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        let signature = sk.sign(payload_json.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

        let result = verify(payload_json, sig_b64).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("bad_fingerprint"));
    }

    #[test]
    fn test_verify_zero_timestamp() {
        let sk = test_signing_key();
        let payload = serde_json::json!({
            "payload": "test-license-data",
            "fingerprint": "fp-123456",
            "expires_at_ms": 9999999999999i64,
            "max_chats": 1000,
            "ts": 0 // zero timestamp
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        let signature = sk.sign(payload_json.as_bytes());
        let sig_b64 = base64::engine::general_purpose::STANDARD.encode(signature.to_bytes());

        let result = verify(payload_json, sig_b64).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("invalid_timestamp"));
    }

    #[test]
    fn test_verify_invalid_signature_length() {
        let payload = serde_json::json!({
            "payload": "test",
            "fingerprint": "fp",
            "expires_at_ms": 9999999999999i64,
            "max_chats": 1000,
            "ts": 1234567890i64
        });
        let payload_json = serde_json::to_string(&payload).unwrap();

        // Empty signature
        let result = verify(payload_json.clone(), "".to_string()).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("invalid_signature_length"));

        // Short signature
        let result = verify(payload_json, "AAAA".to_string()).unwrap();
        assert!(!result.valid);
        assert_eq!(result.reason.as_deref(), Some("invalid_signature_length"));
    }

    // ========== fingerprint tests ==========

    #[cfg(target_os = "linux")]
    #[test]
    fn test_fingerprint_format() {
        let result = fingerprint().unwrap();
        // SHA-256 hex is 64 characters
        assert_eq!(result.len(), 64);
        // All hex chars
        assert!(result.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_fingerprint_deterministic() {
        let fp1 = fingerprint().unwrap();
        let fp2 = fingerprint().unwrap();
        assert_eq!(fp1, fp2, "Fingerprint should be deterministic");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn test_fingerprint_depends_on_hardware() {
        // The fingerprint should be stable but different from empty values
        let result = fingerprint().unwrap();
        assert!(!result.is_empty());
        // All zeros would be suspicious
        assert_ne!(result, "0000000000000000000000000000000000000000000000000000000000000000");
    }

    // macOS / Windows 上 /proc/cpuinfo 不存在，运行时由生产 Dockerfile（target=linux）覆盖
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn test_fingerprint_unsupported_platform() {
        // 只断言：失败时给出明确原因，不静默
        let err = fingerprint().unwrap_err();
        let reason = format!("{:?}", err);
        assert!(
            reason.contains("read /proc/cpuinfo")
                || reason.contains("read product_uuid")
                || reason.contains("exec lsblk")
                || reason.contains("no valid network interface"),
            "expected platform-specific error, got: {}",
            reason
        );
    }

    // ========== antireplay tests ==========

    #[test]
    fn test_antireplay_new_file() {
        let tmpdir = TempDir::new().unwrap();
        let state_path = tmpdir.path().join("license.state");

        let result = antireplay(
            state_path.to_string_lossy().to_string(),
            1000
        ).unwrap();

        assert!(result.ok);
        assert!(result.advanced);
        assert_eq!(result.last_ts, 1000);
    }

    #[test]
    fn test_antireplay_advance() {
        let tmpdir = TempDir::new().unwrap();
        let state_path = tmpdir.path().join("license.state");

        // First advance
        let _ = antireplay(state_path.to_string_lossy().to_string(), 1000).unwrap();

        // Second advance
        let result = antireplay(state_path.to_string_lossy().to_string(), 2000).unwrap();

        assert!(result.ok);
        assert!(result.advanced);
        assert_eq!(result.last_ts, 2000);
    }

    #[test]
    fn test_antireplay_same_timestamp() {
        let tmpdir = TempDir::new().unwrap();
        let state_path = tmpdir.path().join("license.state");

        // First write
        let _ = antireplay(state_path.to_string_lossy().to_string(), 1000).unwrap();

        // Same timestamp - not an advance but not a rollback
        let result = antireplay(state_path.to_string_lossy().to_string(), 1000).unwrap();

        assert!(result.ok);
        assert!(!result.advanced); // Not advancing
        assert_eq!(result.last_ts, 1000);
    }

    #[test]
    fn test_antireplay_rollback() {
        let tmpdir = TempDir::new().unwrap();
        let state_path = tmpdir.path().join("license.state");

        // First write
        let _ = antireplay(state_path.to_string_lossy().to_string(), 2000).unwrap();

        // Try to write earlier timestamp
        let result = antireplay(state_path.to_string_lossy().to_string(), 1000).unwrap();

        assert!(!result.ok);
        assert!(!result.advanced);
        assert_eq!(result.last_ts, 2000); // Should keep old value
    }

    #[test]
    fn test_antireplay_corrupted_file() {
        let tmpdir = TempDir::new().unwrap();
        let state_path = tmpdir.path().join("license.state");

        // Write corrupted JSON
        fs::write(&state_path, "not valid json {").unwrap();

        // Should handle gracefully - treat as new
        let result = antireplay(state_path.to_string_lossy().to_string(), 1000).unwrap();

        assert!(result.ok);
        assert!(result.advanced);
    }

    // ========== selfcheck tests ==========

    #[test]
    fn test_selfcheck_basic() {
        let result = selfcheck().unwrap();
        // Should return clean=false if debugger detected, or clean=true otherwise
        // In test environment, likely clean
        if result.clean {
            assert!(result.evidence.is_empty());
        } else {
            assert!(!result.evidence.is_empty());
        }
    }

    #[test]
    fn test_selfcheck_returns_evidence() {
        let result = selfcheck().unwrap();
        // evidence 始终是 Vec；空数组也合法（生产干净环境）
        // 关键不变量：clean == evidence.is_empty()
        assert_eq!(result.clean, result.evidence.is_empty());
        // 在测试环境（cargo test），不应有 TracerPid / LD_PRELOAD
        for ev in &result.evidence {
            assert!(
                ["tracer", "debugPort", "ld_preload", "ld_library_preload"]
                    .contains(&ev.as_str()),
                "unexpected evidence kind: {ev}"
            );
        }
    }

    #[test]
    fn test_selfcheck_detects_ld_preload() {
        // 验证 LD_PRELOAD 分支：把环境变量设上，evidence 必然非空且包含 ld_preload
        // 使用临时作用域：with_var 风格的 cleanup 由 std 确保在测试结束时还原
        std::env::set_var("LD_PRELOAD", "/tmp/nonexistent.so");
        let result = selfcheck().unwrap();
        // 清理
        std::env::remove_var("LD_PRELOAD");

        assert!(!result.clean, "LD_PRELOAD set → clean must be false");
        assert!(
            result.evidence.iter().any(|e| e == "ld_preload"),
            "evidence should mention ld_preload, got: {:?}",
            result.evidence
        );
    }
}