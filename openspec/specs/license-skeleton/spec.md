# license-skeleton Specification

## Purpose
Verifies the software license at startup and during operation so the bot stops serving paid features when the license is missing, expired, or bound to a different machine — with a mock-friendly implementation that lets development proceed without a Rust native binary.

## Requirements

### Requirement: ILicenseVerifier interface
The system MUST define an `ILicenseVerifier` interface with method `verify(): Promise<LicenseState>` where `LicenseState = {valid: boolean, reason?: string, expiresAt?: Date, daysLeft?: number, maxChats?: number, fingerprint?: string}`. The selected implementation is chosen by the `USE_MOCK_LICENSE` env variable.

#### Scenario: Mock verifier selected
- **WHEN** `USE_MOCK_LICENSE=true`
- **THEN** the system uses `MockLicenseVerifier` and never loads the native `license-native` module

#### Scenario: Native verifier selected
- **WHEN** `USE_MOCK_LICENSE=false`
- **THEN** the system uses `NativeLicenseVerifier` which loads `packages/license-native/prebuilds/<platform>.node`

### Requirement: License file must exist
The system MUST require the path in `LICENSE_FILE` (default `license/license.lic`) to be readable at startup. If the file is missing in mock mode, the system logs a WARN but continues; in non-mock mode, the system exits with code 1.

#### Scenario: File present
- **WHEN** `LICENSE_FILE` resolves to a readable file
- **THEN** the system continues startup and caches the verification result

#### Scenario: File missing in mock mode
- **WHEN** `USE_MOCK_LICENSE=true` and the file does not exist
- **THEN** the system logs WARN, sets `valid=true, reason='mock-no-file'`, and continues

#### Scenario: File missing in non-mock mode
- **WHEN** `USE_MOCK_LICENSE=false` and the file does not exist
- **THEN** the system logs ERROR with reason `license-file-missing` and `process.exit(1)` before HTTP listen

### Requirement: License file format validation
The system MUST validate that the license file has the format `<base64(json payload)>.<base64(Ed25519 signature)>`. If parsing fails in mock mode, the system logs WARN and returns a synthetic valid state; in non-mock mode, this is a hard fail.

#### Scenario: Malformed file in mock mode
- **WHEN** the file does not contain exactly one `.` separator between two base64-encoded parts
- **THEN** the system logs WARN, returns `{valid:true, reason:'mock-malformed', expiresAt: null}`, and continues

### Requirement: Cached license state with hourly refresh
The system MUST cache the verification result in Redis under `license:cache` with TTL 3600 seconds. A guard at pipeline entry reads the cache and returns within 1ms.

#### Scenario: Cache hit
- **WHEN** the guard runs and a cached state with `valid=true` exists
- **THEN** processing continues without re-verification

#### Scenario: Cache miss or expired
- **WHEN** the cached state has expired or is absent
- **THEN** the guard triggers `verify()` and writes a new cache entry

### Requirement: Hot reload via admin endpoint
The system MUST expose `POST /admin/license/reload` that re-runs `verify()`, updates the cache, and returns the new state without restarting the adapter.

#### Scenario: Operator triggers reload
- **WHEN** an admin posts to `/admin/license/reload` after replacing the license file
- **THEN** within 1 second, the new license state is in effect for subsequent pipeline messages

### Requirement: Restricted mode on invalid license
The system MUST switch to restricted mode when the cached license state has `valid=false`: every callback returns only the authorization-prompt text with `ErrCode.LICENSE_RESTRICTED`, and `/healthz` returns `503`.

#### Scenario: License expires
- **WHEN** the daily 03:00 re-check finds `expiresAt < now`
- **THEN** the cache is updated to `valid=false`, health probes fail, and the bot stops answering real questions

### Requirement: LicenseService factory branches by USE_MOCK_LICENSE
The system MUST construct the verifier in `LicenseService` via a conditional on `USE_MOCK_LICENSE`: when `true`, the verifier MUST be `MockLicenseVerifier`; when `false`, the verifier MUST be `NativeLicenseVerifier` (loading `packages/license-native/prebuilds/<platform>.node` once available). The constructed verifier instance type MUST be observable through `/admin/license` (`mock` field) and the startup log MUST include `verifierType: 'mock' | 'native-placeholder'`.

#### Scenario: Mock mode active
- **WHEN** `USE_MOCK_LICENSE=true`
- **THEN** `LicenseService` MUST hold a `MockLicenseVerifier` instance and `/admin/license` MUST return `mock: true`

#### Scenario: Native mode active
- **WHEN** `USE_MOCK_LICENSE=false`
- **THEN** `LicenseService` MUST hold a `NativeLicenseVerifier` instance and `/admin/license` MUST return `mock: false`

#### Scenario: Native placeholder before prebuild injection
- **WHEN** `USE_MOCK_LICENSE=false` and `packages/license-native/prebuilds/*.node` is not yet present
- **THEN** `NativeLicenseVerifier` MUST return a placeholder `LicenseState` with `reason: 'native-placeholder'` and the startup log MUST print a WARN identifying the missing prebuild
