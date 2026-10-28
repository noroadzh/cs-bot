# Spec Delta

## ADDED Requirements

### Requirement: Provisioning credential handoff

When provisioning generates administrator credentials, the system MUST return them exactly once in the provisioning response (or a dedicated one-time handoff endpoint), MUST NOT write their plaintext to logs or audit payloads, and MUST NOT expose them again through any later read or list endpoint. An operator MUST be able to rotate them through the tenant secrets update API.

#### Scenario: Generated credentials returned once

- **WHEN** a tenant is provisioned with generated admin and FastGPT root passwords
- **THEN** the provisioning response contains them once and subsequent tenant detail or secrets reads do not

#### Scenario: Plaintext never logged

- **WHEN** provisioning returns generated credentials
- **THEN** logs and audit entries contain key names only, never the values

#### Scenario: Rotation after handoff

- **WHEN** an operator updates a generated credential through the secrets API
- **THEN** the new value is stored encrypted and the old one is no longer used by the instance after restart/reload
