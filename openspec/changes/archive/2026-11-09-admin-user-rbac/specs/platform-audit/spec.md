## ADDED Requirements

### Requirement: Request-level audit alongside chained mutation audit

The control plane MUST record a **request-level** operation audit entry for every `/platform/*` management API call as defined by `admin-identity` (`admin_audit_log` / `GET /platform/audit-logs`). This request-level log MUST coexist with the existing append-only **hash-chained** mutation audit (`platform-audit` entries with `reason`, `prev_hash`/`hash`, `GET /platform/audit-log`, and `GET /platform/audit-log/verify`). Request-level audit MUST NOT replace, weaken, or skip chained mutation audit for successful dangerous mutations. Successful platform mutations that today require a non-empty `reason` MUST still write exactly one chained audit entry with that reason.

#### Scenario: Mutation writes both audit kinds

- **WHEN** an authenticated platform admin successfully suspends a tenant with a non-empty `reason`
- **THEN** exactly one hash-chained mutation audit entry exists for that suspend **and** one request-level audit row exists for the HTTP call (method/path/status/actor username)

#### Scenario: Read-only platform call is request-audited only

- **WHEN** an authenticated platform admin calls a read-only `/platform/*` endpoint (e.g. list tenants)
- **THEN** a request-level audit row is written and no hash-chained mutation entry is required for that read

#### Scenario: Missing reason still blocks mutation chain

- **WHEN** a platform mutation is submitted without `reason`
- **THEN** the system returns HTTP 400, writes no hash-chained mutation entry, and still records a request-level audit row with the 400 status (without storing secrets)

### Requirement: Platform request-level audit query

The control plane MUST expose `GET /platform/audit-logs` (plural) for request-level rows, separate from `GET /platform/audit-log` (singular) hash-chain query. The endpoint MUST require authenticated role `admin`, return `{ total, limit, offset, rows }` ordered by `created_at` descending, and MUST NOT expose passwords or Authorization material. Hash-chain verify (`GET /platform/audit-log/verify`) MUST remain unchanged in purpose.

#### Scenario: Admin lists request-level platform audits

- **WHEN** an authenticated platform admin calls `GET /platform/audit-logs`
- **THEN** the response lists request-level rows with username, role, method, path, status, costMs, clientIp, and createdAt

#### Scenario: Paths remain distinct

- **WHEN** an operator queries mutation chain history
- **THEN** they continue to use `GET /platform/audit-log` (and verify via `/platform/audit-log/verify`), not `/platform/audit-logs`

### Requirement: Platform user management uses DB identity

Control-plane `/platform/*` authentication MUST use the same database-backed Basic Auth model as `admin-identity` (control-plane DB users/roles). Platform user management endpoints (`/platform/users*`) MUST be request-audited. Actor identity recorded in hash-chained mutation audits SHOULD use the authenticated DB username (e.g. the former `ops:alice` style MAY become the DB username) so operations remain attributable to a person.

#### Scenario: Platform DB user authenticates

- **WHEN** Basic Auth matches an enabled control-plane `admin_user`
- **THEN** `/platform/*` handlers run with that user's role and username available to both audit layers

#### Scenario: Platform user create is audited at request level

- **WHEN** a platform admin creates a user via `POST /platform/users`
- **THEN** a request-level audit row records the caller, path, and status without the new password
