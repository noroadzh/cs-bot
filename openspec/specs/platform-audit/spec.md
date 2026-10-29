# platform-audit Specification

## Purpose

为平台控制面提供 append-only、链式哈希防篡改的操作审计日志，使运营方能够追溯每一次租户生命周期与配额变更，并能检测日志是否被绕过控制面的方式修改。

## Requirements

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
  - `tenant.credentials` — `{tenantId, keys}` for a one-time credential handoff
  - `shell_access` — `{tenantId, durationMs}` for an audited operator shell session
  and each entry carries `payload.reason`

#### Scenario: Quota change records old and new values

- **WHEN** an operator raises `maxChats` from 5 to 50 with a reason
- **THEN** the entry's `payload` contains both `before.maxChats: 5` and `after.maxChats: 50`

#### Scenario: Credential handoff has a vocabulary entry

- **WHEN** an operator retrieves generated tenant credentials
- **THEN** the audit action is `tenant.credentials` with key names only and no plaintext values

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

### Requirement: Audit actor and failure handling

The system MUST set `actor` to the authenticated operator identity for operator-driven mutations and to `system:sweep` for the expiry sweep. A mutation whose audit write fails MUST still complete the mutation and MUST log the audit failure as an error (audit failure does not roll back the mutation).

#### Scenario: Operator-driven action records operator

- **WHEN** an operator with identity `ops:alice` calls suspend
- **THEN** the entry's `actor` is `ops:alice`

#### Scenario: Audit failure does not block mutation

- **WHEN** the audit insert throws but the tenant suspend succeeded
- **THEN** the tenant stays `paused`, the audit failure is logged as an error, and the suspend response is still HTTP 200

### Requirement: Chained hash integrity

Each audit entry MUST carry `prev_hash` (the `hash` of the immediately preceding entry by insertion order, `""` for the very first entry) and `hash`, computed as sha256 over a canonical serialization of `{prev_hash, action, actor, tenant_id, payload, created_at}`. The chain MUST be computed inside the same transaction as the entry insert so concurrent writes cannot fork the chain.

#### Scenario: Chain links consecutive entries

- **WHEN** two entries are written in order
- **THEN** the second entry's `prev_hash` equals the first entry's `hash`

#### Scenario: First entry has empty prev_hash

- **WHEN** the very first audit entry is written on an empty log
- **THEN** its `prev_hash` is the empty string and its `hash` verifies against its own fields

#### Scenario: Concurrent writes keep one chain

- **WHEN** two platform mutations commit at the same time
- **THEN** the resulting entries form a single linear chain without a shared `prev_hash`

### Requirement: Audit log verification

The system MUST provide `GET /platform/audit-log/verify` that recomputes the hash chain over the whole log and returns `{valid: true, entries: <count>}` when every link and hash verifies, and `{valid: false, brokenAtId, entries: <count>}` naming the first entry whose `prev_hash` or recomputed `hash` does not match.

#### Scenario: Intact log verifies

- **WHEN** verify is called on a log of 40 entries that was only written through the normal path
- **THEN** the response is `{valid: true, entries: 40}`

#### Scenario: Tampered payload detected

- **WHEN** a row's `payload` is modified directly in the database and verify is called
- **THEN** the response is `{valid: false, brokenAtId: <that row's id>}`

#### Scenario: Deleted middle entry detected

- **WHEN** a middle row is deleted directly and verify is called
- **THEN** the first entry whose `prev_hash` no longer matches its predecessor's `hash` is reported

### Requirement: Audit log query

The system MUST provide `GET /platform/audit-log` returning `{total, limit, offset, rows}` ordered by `created_at` descending (insertion order for equal timestamps), with `limit` (default 50, max 200), `offset`, and optional filters `tenant_id`, `action`, and `from`/`to` on `created_at`. The endpoint MUST NOT expose `prev_hash`/`hash` omission as a filterable concern: hash fields MUST always be present in rows.

#### Scenario: Filter by tenant

- **WHEN** an operator calls `GET /platform/audit-log?tenant_id=<id>` when 7 of 30 entries concern that tenant
- **THEN** the response holds exactly those 7 entries and `total: 7`

#### Scenario: Filter by action and time range

- **WHEN** an operator calls `?action=tenant.suspend&from=2026-10-01&to=2026-10-07`
- **THEN** only suspend entries within the range are returned

#### Scenario: Hash fields always present

- **WHEN** any audit query returns rows
- **THEN** every row includes `prev_hash` and `hash`
