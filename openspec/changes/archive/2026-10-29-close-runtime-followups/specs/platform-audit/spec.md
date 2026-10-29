# Spec Delta

## MODIFIED Requirements

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
  - `tenant.credentials` — `{tenantId, keys}` for a one-time credential handoff
  - `shell_access` — `{tenantId, durationMs}` for an audited operator shell session
  and each entry carries `payload.reason`

#### Scenario: Quota change records old and new values

- **WHEN** an operator raises `maxChats` from 5 to 50 with a reason
- **THEN** the entry's `payload` contains both `before.maxChats: 5` and `after.maxChats: 50`

#### Scenario: Credential handoff has a vocabulary entry

- **WHEN** an operator retrieves generated tenant credentials
- **THEN** the audit action is `tenant.credentials` with key names only and no plaintext values

## ADDED Requirements

### Requirement: Audit offsite retention

Before the local cleanup deletes audit entries older than 180 days, the system MUST export those entries to the configured offsite target and MUST delete the local rows only after the export succeeds. If the offsite export fails, the cleanup MUST leave the rows in place and surface an error.

#### Scenario: Export succeeds before cleanup

- **WHEN** the cleanup finds audit rows older than 180 days and the offsite export succeeds
- **THEN** the rows are exported and then deleted locally

#### Scenario: Export failure preserves rows

- **WHEN** the offsite export fails
- **THEN** no local audit row is deleted and an error is logged

#### Scenario: Retention window respected

- **WHEN** the cleanup runs with entries newer than 180 days
- **THEN** those entries are neither exported nor deleted
