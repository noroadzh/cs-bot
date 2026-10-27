# Spec Delta: tenant-quota

## ADDED Requirements

### Requirement: Runtime quota and state propagation

When a tenant's quota or serving state changes in the control plane, the change MUST be pushed to the tenant instance so its local admission gate enforces the new values without waiting for a redeploy. Failed pushes MUST be retried and audited.

#### Scenario: Quota change reaches instance

- **WHEN** an operator updates `maxChats`/`maxApiCalls` for a provisioned tenant
- **THEN** the tenant instance persists the new quota and enforcement uses it

#### Scenario: Suspend reaches instance

- **WHEN** a tenant is suspended in the control plane
- **THEN** the instance rejects new messages with the tenant-inactive behavior

#### Scenario: Push failure retried

- **WHEN** the instance sync call fails
- **THEN** the control plane retries with backoff and records the failure in audit
