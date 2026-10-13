# license-skeleton Specification (Delta)

## ADDED Requirements

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
