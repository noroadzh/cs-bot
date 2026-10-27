# license-build Specification

## Purpose
Integrates the Rust N-API license module (change A) into `apps/adapter` with **startup-time
hard validation**: tamper selfcheck, machine fingerprint binding, and anti-replay state.
Also tightens the mock verifier so that `USE_MOCK_LICENSE=true` no longer means
"any license passes" — it means "signature verification is stubbed, format + binding are real".

This spec is merged into the main `license-skeleton` spec as requirement M9-Bind-Integration.

## Requirements

### Requirement: Startup license binding sequence
The system MUST integrate the native license module at application bootstrap with a `startupCheck()` sequence that performs, in order:
1. Declare `@cs-bot/license-native` as a `workspace:*` dependency of `apps/adapter`
2. Load the native module via `createRequire` in `NativeLicenseVerifier`
3. `fingerprint()` — capture and cache the host machine fingerprint
4. `selfcheck()` — tamper detection; on `clean: false` the process MUST exit with code 1 and log the `evidence[]` array
5. `verifyAndCache()` — license verification + anti-replay

Source: SHA-3.1.12

#### Scenario: Clean startup, valid license
- **WHEN** `startupCheck()` runs on a clean host with a valid, non-expired, fingerprint-bound license
- **THEN** the process continues to serve traffic and caches the verified license state

#### Scenario: Tamper detected at startup
- **WHEN** `selfcheck()` returns `clean: false`
- **THEN** the process exits with code 1 and logs the `evidence[]` array before terminating

#### Scenario: Invalid license in production
- **WHEN** the resulting license state is invalid AND `NODE_ENV === 'production'`
- **THEN** the process exits with code 1

#### Scenario: Invalid license in development
- **WHEN** the resulting license state is invalid AND `NODE_ENV !== 'production'`
- **THEN** the process logs a warning and continues serving traffic

### Requirement: Fingerprint binding enforcement
The system MUST reject any license whose `fingerprint` field does not equal the captured host fingerprint, returning `reason: 'fingerprint-mismatch'`, and MUST reject any license whose anti-replay check fails, returning `reason: 'antireplay-failure'`. The anti-replay state file MUST persist at `license/.antireplay.json` with mode `0600`.

Source: SHA-3.1.12

#### Scenario: Fingerprint mismatch
- **WHEN** the license's `fingerprint` field does not equal the captured host fingerprint
- **THEN** verification returns `{valid: false, reason: 'fingerprint-mismatch'}`

#### Scenario: Anti-replay failure
- **WHEN** the anti-replay check detects time rollback or a write failure
- **THEN** verification returns `{valid: false, reason: 'antireplay-failure'}`

#### Scenario: Anti-replay state file permissions
- **WHEN** the anti-replay state file is written
- **THEN** it is persisted at `license/.antireplay.json` with filesystem mode `0600`

### Requirement: Strict mock verifier
The `MockLicenseVerifier` MUST stop returning `valid: true` unconditionally. It MUST:
1. Return `{valid: false, reason: 'mock-no-license', mock: true}` when the license file does not exist on disk
2. Return `{valid: false, reason: 'malformed', mock: true}` when the file does not match the `<base64payload>.<base64sig>` format, or the decoded payload is not valid JSON
3. Return `valid: true` only when the payload decodes and yields a non-empty `expiresAt` or `fingerprint`
4. Skip Ed25519 signature verification (mock mode stubs signing only, not binding)
5. Apply the same fingerprint-binding check as the native verifier

Source: SHA-3.1.13

#### Scenario: No license file in mock mode
- **WHEN** the mock verifier is used and the license file does not exist on disk
- **THEN** it returns `{valid: false, reason: 'mock-no-license', mock: true}`

#### Scenario: Malformed license file in mock mode
- **WHEN** the mock verifier is used and the file does not match `<base64payload>.<base64sig>` or the payload is not valid JSON
- **THEN** it returns `{valid: false, reason: 'malformed', mock: true}`

#### Scenario: Valid payload in mock mode
- **WHEN** the decoded payload yields a non-empty `expiresAt` or `fingerprint`
- **THEN** it returns `valid: true` with `mock: true` after applying the fingerprint-binding check

### Requirement: License binding test coverage
The license integration MUST be covered by unit tests achieving at least 75% statement, 75% branch, 75% function and 75% line coverage across `apps/adapter/src/license/**`, consistent with the repository-wide coverage gate.

The tests MUST cover:
- `startupCheck()` four-step ordering
- `selfcheck()` returning `clean: false` causing a process exit
- `fingerprint-mismatch` rejection in both mock and native verifiers
- All four mock verifier outcome branches (missing / malformed / valid / parse-error)

Source: SHA-3.1.14

#### Scenario: Coverage threshold met
- **WHEN** the unit test suite for `apps/adapter/src/license/**` runs
- **THEN** statement, branch, function and line coverage each reach at least 75%

#### Scenario: Required branches covered
- **WHEN** the suite runs
- **THEN** it contains cases for the four-step `startupCheck()` ordering, the `clean: false` exit path, `fingerprint-mismatch` in both verifiers, and all four mock outcome branches

### Requirement: Delivery-side license issuer tool

The delivery side MUST provide a CLI that signs license payloads with the issuer private key and emits the compact `base64(payload).base64(signature)` format accepted by the runtime verifier. The tool and private key MUST NOT be included in runtime images.

#### Scenario: Issue a license

- **WHEN** the issuer tool is given a payload with fingerprint, expiry, and max chats
- **THEN** it emits a license file that the native verifier accepts

#### Scenario: Not shipped at runtime

- **WHEN** inspecting the adapter runtime image
- **THEN** no issuer tool or private key is present
