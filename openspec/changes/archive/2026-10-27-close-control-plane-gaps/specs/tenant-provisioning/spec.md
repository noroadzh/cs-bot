# Spec Delta: tenant-provisioning

## ADDED Requirements

### Requirement: FastGPT initialization handoff

Provisioning MUST provide a documented, idempotent path to finish FastGPT initialization (model channel and API key) and update the tenant secret bundle, without re-provisioning the tenant.

#### Scenario: API key updated

- **WHEN** the operator updates the FastGPT API key after FastGPT starts
- **THEN** the tenant adapter is restarted/reloaded and uses the new key

#### Scenario: Local channel configured

- **WHEN** `MODEL_MODE=local|hybrid` is selected
- **THEN** the runbook requires the FastGPT local model channel to be configured before serving
