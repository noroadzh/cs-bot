# Spec Delta

## MODIFIED Requirements

### Requirement: Audit entry on every platform mutation

The system MUST write exactly one audit entry for every successful platform mutation, in the same transaction as the mutation when the storage engine permits it. Every entry MUST include a non-empty operator-supplied `reason`; a mutation request without a reason MUST be rejected with HTTP 400 and MUST NOT be executed.

#### Scenario: Provision writes one audit entry

- **WHEN** a tenant provision succeeds with a reason
- **THEN** exactly one audit entry exists with `action: "tenant.provision"`, the operator as `actor`, the reason in `payload.reason`, and the instance host/port in `payload`

#### Scenario: Missing reason rejected

- **WHEN** a platform mutation is submitted without `reason`
- **THEN** the system returns HTTP 400 and writes no audit entry

#### Scenario: Failed mutation writes no entry

- **WHEN** a suspend is rejected with HTTP 409 because the status transition is illegal
- **THEN** no audit entry is written for that rejected mutation

### Requirement: Audit action vocabulary

The system MUST classify every platform mutation with an `action` drawn from the fixed vocabulary below, and MUST include the listed payload fields for that action. No other `action` value MAY be written by control-plane endpoints.

#### Scenario: Vocabulary and required payloads

- **WHEN** any control-plane mutation is audited
- **THEN** the entry's `action` is one of:
  - `tenant.create` — `{tenantId, name, plan, subscriptionExpiresAt}`
  - `tenant.provision` — `{tenantId, instanceHost, instancePort, composeFilePath}`
  - `tenant.suspend` / `tenant.resume` — `{tenantId}`
  - `tenant.terminate` — `{tenantId, droppedDatabase}`
  - `tenant.renew` — `{tenantId, days, beforeExpiresAt, afterExpiresAt, licenseIssued}`
  - `tenant.quota-set` — `{tenantId, before, after}`
  - `tenant.expired-sweep` / `tenant.paused-sweep` — `{tenantId, fromStatus, toStatus}`
  - `tenant.sync`, `tenant.restart`, `tenant.alert` — `{tenantId}` plus the operation detail
  - `tenant.export`, `tenant.destroy_scheduled`, `tenant.destroyed` — `{tenantId}` plus the schedule/package detail
  - `shell_access` — `{tenantId, durationMs}` for an audited operator shell session
  and each entry carries `payload.reason`

#### Scenario: Quota change records old and new values

- **WHEN** an operator raises `maxChats` from 5 to 50 with a reason
- **THEN** the entry's `payload` contains both `before.maxChats: 5` and `after.maxChats: 50`
