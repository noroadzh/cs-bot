# license-native-core Specification

## Purpose
Provides a Rust N-API module implementing the M9 license authorization core:
- Ed25519 signature verification
- Machine fingerprint collection
- Anti-replay protection via timestamp state
- Tamper detection (debugger, tracer, LD_PRELOAD)

This spec is merged into the main `license-skeleton` spec as requirement M9-Native-Core.

## Requirements

### Requirement: Native Ed25519 license verification
The system MUST provide a native Rust N-API function `verify(payload_json, sig_b64)` that:
1. Decodes the base64 signature
2. Parses a JSON payload containing `{payload, fingerprint, expiresAtMs, maxChats, ts}`
3. Verifies the Ed25519 signature against a compile-time embedded public key
4. Rejects expired licenses (`expiresAtMs < now`)
5. Rejects empty fingerprints
6. Returns `{valid: bool, reason: string|null, expiresAtMs: i64, maxChats: i32}`

Source: SHA-3.1.7

#### Scenario: Valid license signature
- **WHEN** `verify` is called with a payload whose signature matches the embedded public key and whose `expiresAtMs` is in the future
- **THEN** it returns `{valid: true, reason: null, expiresAtMs, maxChats}`

#### Scenario: Tampered payload
- **WHEN** any byte of the payload has been altered after signing
- **THEN** Ed25519 verification fails and it returns `{valid: false, reason: <non-null>}`

#### Scenario: Expired license
- **WHEN** the decoded payload carries an `expiresAtMs` earlier than the current time
- **THEN** it returns `{valid: false, reason: <expiry reason>}` without rewriting state

#### Scenario: Empty fingerprint
- **WHEN** the decoded payload carries an empty `fingerprint`
- **THEN** it returns `{valid: false, reason: <fingerprint reason>}`

### Requirement: Native machine fingerprint collection
The system MUST provide a native Rust N-API function `fingerprint()` that:
1. Reads the CPU model from `/proc/cpuinfo` (the `model name` line)
2. Reads the DMI product UUID from `/sys/class/dmi/id/product_uuid`
3. Reads the primary MAC address from `/sys/class/net/eth0/address`
4. Reads the disk serial via `lsblk`
5. Returns the SHA-256 of the concatenated values joined with a `|` separator
6. Returns an Error when any file read or command execution fails

Source: SHA-3.1.8

#### Scenario: All sources readable
- **WHEN** every fingerprint source is present on the host
- **THEN** the function returns a stable 64-character hex digest

#### Scenario: Fingerprint is stable across calls
- **WHEN** `fingerprint` is called twice on the same unchanged host
- **THEN** both calls return the same digest

#### Scenario: A source is unreadable
- **WHEN** any one of the CPU, DMI, MAC, or disk sources cannot be read or executed
- **THEN** the function returns an Error rather than a partial digest

### Requirement: Native anti-replay protection
The system MUST provide a native Rust N-API function `antireplay(state_path, now_ms)` that:
1. Reads a JSON state file of shape `{last_ts: i64}`, creating it with `last_ts: 0` when absent
2. Rejects the call when `now_ms < last_ts` (time rollback detected)
3. Updates and writes the state file with the new `now_ms` on success
4. Returns `{ok: bool, advanced: bool, last_ts: i64}`

Source: SHA-3.1.9

#### Scenario: Monotonic clock advances
- **WHEN** `antireplay` is called with `now_ms` greater than the persisted `last_ts`
- **THEN** it returns `{ok: true, advanced: true, last_ts: now_ms}` and persists `now_ms`

#### Scenario: Clock rolled backwards
- **WHEN** `antireplay` is called with `now_ms` less than the persisted `last_ts`
- **THEN** it returns `ok: false` with `advanced: false` and leaves the state file unchanged

#### Scenario: First call with no state file
- **WHEN** the state file does not exist and `now_ms` is non-negative
- **THEN** it creates the file with `last_ts: now_ms` and returns `ok: true`

### Requirement: Native tamper self-check
The system MUST provide a native Rust N-API function `selfcheck()` that:
1. Checks that `process.debugPort !== 0`
2. Checks that `/proc/self/status` reports `TracerPid` of `"0"`
3. Checks the `LD_PRELOAD` and `LD_LIBRARY_PRELOAD` environment variables
4. Returns `{clean: bool, evidence: string[]}`

Source: SHA-3.1.10

#### Scenario: Clean process
- **WHEN** no debugger is attached, no tracer is present, and neither preload variable is set
- **THEN** it returns `{clean: true, evidence: []}`

#### Scenario: Debugger attached
- **WHEN** `process.debugPort` is non-zero or `TracerPid` is non-zero
- **THEN** it returns `{clean: false}` with an `evidence` entry naming the detection

#### Scenario: Preload injection
- **WHEN** `LD_PRELOAD` or `LD_LIBRARY_PRELOAD` is set to a non-empty value
- **THEN** it returns `{clean: false}` with an `evidence` entry naming the variable

### Requirement: Native release build hardening
The Rust module MUST be compiled in release mode with:
- `strip = "symbols"`
- `lto = true`
- `codegen-units = 1`
- `panic = "abort"`
- `opt-level = "z"`

Source: SHA-3.1.11

#### Scenario: Release profile is hardened
- **WHEN** the module is built with the release profile
- **THEN** the emitted artifact has symbols stripped and all five hardening flags applied
