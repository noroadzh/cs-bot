# Spec Delta

## ADDED Requirements

### Requirement: Delivery integrity and secret preflight

The installer MUST verify the delivery package checksum manifest before starting containers and MUST refuse to proceed when any file mismatches. It MUST also refuse to start with known-weak or short administrative secrets, naming each offending key.

#### Scenario: Checksum mismatch aborts

- **WHEN** `SHA256SUMS.txt` is present and any listed file differs
- **THEN** the installer exits non-zero, names the mismatching files, and starts no container

#### Scenario: Weak secret rejected

- **WHEN** `ADMIN_PASSWORD`, `POSTGRES_PASSWORD` or `FASTGPT_ROOT_PASSWORD` is missing, shorter than 12 characters, or a known default
- **THEN** the installer exits non-zero and names the offending key

#### Scenario: Valid package proceeds

- **WHEN** checksums match and all required secrets are strong
- **THEN** the installer proceeds to start the baseline stack
