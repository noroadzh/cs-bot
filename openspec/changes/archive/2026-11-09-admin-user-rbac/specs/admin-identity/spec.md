## Purpose

管理面身份：数据库用户与可扩展角色、密码哈希 Basic Auth、用户 CRUD、首用户引导，以及请求级操作审计。适用于租户数据面 `/admin/*` 与控制面 `/platform/*`；两端身份库隔离，不做跨实例联邦。

## ADDED Requirements

### Requirement: Persistent admin roles and users

The system MUST persist management roles and users in the local PostgreSQL of each surface (tenant data-plane DB for `/admin/*`, control-plane DB for `/platform/*`). The schema MUST include at least:

- `admin_role(code PK, name, …)` seeded with `admin` and `operator`
- `admin_user(id, username UNIQUE, password_hash, role_code FK → admin_role, enabled, created_at, updated_at, …)`
- `admin_audit_log(id, user_id NULL, username, role_code, method, path, status, cost_ms, client_ip, surface, created_at, …)` where `surface` is `admin` or `platform`

Role rows MUST be extensible by inserting new `admin_role` codes without changing the authentication model. This change MUST NOT introduce OAuth/SSO, a fine-grained permission-point matrix, or cross-tenant identity federation.

#### Scenario: Seed roles exist on fresh migration

- **WHEN** migrations apply to an empty database
- **THEN** `admin_role` contains rows with codes `admin` and `operator`

#### Scenario: Surfaces keep separate identity stores

- **WHEN** an `admin_user` exists only in the tenant data-plane database
- **THEN** that credential MUST NOT authenticate `/platform/*` on the control plane

### Requirement: Password hashing

Passwords MUST be stored only as a one-way hash using argon2id or scrypt (Node-compatible). Plaintext passwords MUST NOT be persisted, logged, or returned in API responses. Verification MUST compare the Basic Auth password against `admin_user.password_hash`.

#### Scenario: Create user stores hash only

- **WHEN** an admin creates a user with password `P`
- **THEN** the row stores a non-empty `password_hash` that is not equal to `P`, and list/detail responses omit the password and hash

#### Scenario: Wrong password fails verification

- **WHEN** Basic Auth presents a matching username with an incorrect password
- **THEN** authentication fails and no session is established beyond the failed request

### Requirement: Database-backed Basic Auth

HTTP Basic Auth for management APIs MUST authenticate against an `enabled` `admin_user` row by username and password hash. Environment variables `ADMIN_USER`, `ADMIN_PASSWORD`, `ADMIN_OPERATOR_USER`, and `ADMIN_OPERATOR_PASSWORD` MUST NOT be accepted as valid login credentials (**BREAKING**). On success the request context MUST expose the authenticated `userId`, `username`, and `role_code` for downstream role checks and audit. Disabled users MUST be rejected as unauthorized.

#### Scenario: Enabled DB user authenticates

- **WHEN** Basic Auth credentials match an `enabled=true` `admin_user` and the IP allowlist admits the client
- **THEN** the request proceeds with that user's `role_code` attached

#### Scenario: Env credentials no longer work

- **WHEN** a client presents Basic Auth equal to legacy `ADMIN_USER`/`ADMIN_PASSWORD` (or operator env pair) and no matching enabled DB user exists
- **THEN** the system returns HTTP 401 with `errCode: AUTH_UNAUTHORIZED` and `WWW-Authenticate: Basic`

#### Scenario: Disabled user rejected

- **WHEN** Basic Auth matches a user with `enabled=false`
- **THEN** the system returns HTTP 401 with `errCode: AUTH_UNAUTHORIZED`

### Requirement: Role checks remain role-code based

Authorization beyond authentication MUST continue to use `role_code` (e.g. `@Roles('admin')`). Built-in semantics: `operator` MAY perform day-to-day ops; `admin` MAY additionally perform privileged mutations (license reload, keyword/sensitive-word reload, user management, full audit-log query). Insufficient role MUST return HTTP 403 with `errCode: AUTH_FORBIDDEN`.

#### Scenario: Operator denied admin-only route

- **WHEN** an authenticated `operator` calls an admin-only endpoint such as `POST /admin/license/reload` or `POST /admin/users`
- **THEN** the response is HTTP 403 with `errCode: AUTH_FORBIDDEN`

#### Scenario: Admin allowed privileged route

- **WHEN** an authenticated `admin` calls the same admin-only endpoint with a valid body
- **THEN** the role check admits the handler (subject to other validations)

### Requirement: User management API (tenant and platform)

The data plane MUST expose user management under `/admin/users*` and the control plane MUST mirror under `/platform/users*`. All user-management routes MUST require role `admin`, Basic Auth against DB users, and the existing IP allowlist. Passwords appear only in write request bodies and MUST never appear in responses.

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/admin/users` · `/platform/users` | Paginated list `{ total, limit, offset, rows }` where each row includes `id`, `username`, `roleCode`, `enabled`, `createdAt`, `updatedAt` (no secrets) |
| `POST` | `/admin/users` · `/platform/users` | Create user; body `{ username, password, roleCode }`; `roleCode` MUST reference an existing `admin_role`; returns HTTP 201 with the created row (no password) |
| `PATCH` | `/admin/users/:id` · `/platform/users/:id` | Update mutable fields (`password?`, `roleCode?`); unknown id → `USER_NOT_FOUND` |
| `POST` | `/admin/users/:id/disable` · `/platform/users/:id/disable` | Set `enabled=false`; MUST reject disabling the last remaining enabled `admin` with `LAST_ADMIN_FORBIDDEN` |

List pagination MUST accept `limit` (default 50, max 200) and `offset` (default 0). Duplicate username on create MUST return a client error with a stable string `errCode` (e.g. `USER_USERNAME_TAKEN`).

#### Scenario: Admin lists users

- **WHEN** an authenticated admin calls `GET /admin/users`
- **THEN** the response is HTTP 200 with `{ total, limit, offset, rows }` and no password fields

#### Scenario: Admin creates operator

- **WHEN** an authenticated admin posts `{ "username": "ops1", "password": "<strong>", "roleCode": "operator" }` to `POST /admin/users`
- **THEN** the system returns HTTP 201, persists a hashed password, and the new user can authenticate as `operator`

#### Scenario: Platform mirror create

- **WHEN** an authenticated platform admin posts a valid create body to `POST /platform/users`
- **THEN** the user is stored in the control-plane database and can authenticate `/platform/*` only

#### Scenario: Unknown user id

- **WHEN** an admin patches or disables `/admin/users/<missing-id>`
- **THEN** the system returns HTTP 404 with `errCode: USER_NOT_FOUND`

#### Scenario: Last enabled admin cannot be disabled

- **WHEN** exactly one enabled user has `roleCode: admin` and an admin calls `POST .../users/:id/disable` on that user
- **THEN** the system returns HTTP 409 (or 403) with `errCode: LAST_ADMIN_FORBIDDEN` and the user remains enabled

#### Scenario: Operator cannot manage users

- **WHEN** an authenticated operator calls `GET /admin/users` or `POST /admin/users`
- **THEN** the system returns HTTP 403 with `errCode: AUTH_FORBIDDEN`

### Requirement: First-admin bootstrap

A fresh deployment with zero `admin_user` rows MUST obtain its first enabled `admin` via the guided installer (`deploy/setup.sh` and control-plane equivalent) or an explicit one-shot bootstrap script for upgrades. Bootstrap MUST write a hashed password into the local DB and MUST NOT leave a permanent env-based login path. When no enabled admin exists, management API login MUST fail with `AUTH_UNAUTHORIZED` and operators MUST be directed to complete bootstrap (documentation / setup messaging).

#### Scenario: Setup creates first admin

- **WHEN** setup collects a username and strong password and bootstrap runs against an empty `admin_user` table
- **THEN** exactly one enabled `admin` user exists and that credential authenticates management APIs

#### Scenario: Upgrade migrates legacy env to first user

- **WHEN** an upgraded instance still has env admin credentials but an empty user table, and the operator runs the documented bootstrap script
- **THEN** a first enabled `admin` is inserted and subsequent logins use only the DB user (env credentials remain non-authoritative)

### Requirement: Request-level management audit

Every authenticated or attempted management API call under `/admin/*` and `/platform/*` (excluding health probes and static console asset GETs that do not hit management controllers) MUST append exactly one request-level row to `admin_audit_log` after the response status is known. Each row MUST record at least: `username` (or empty when unauthenticated), `role_code` when known, `method`, `path`, HTTP `status`, `cost_ms`, `client_ip`, and `surface`. The audit writer MUST NOT store passwords, `Authorization` header values, license material, or raw request/response bodies that may contain secrets; querystring MAY record parameter **names** only (values redacted or omitted).

Audit write failure MUST be logged as an error and MUST NOT change the original HTTP response status of the management call.

#### Scenario: Successful call audited

- **WHEN** an authenticated admin calls `GET /admin/config-check` and receives 200
- **THEN** one `admin_audit_log` row exists with that username, role, method `GET`, path, status 200, client IP, and `surface: admin`

#### Scenario: Failed auth still audited

- **WHEN** a request to `/admin/usage` returns 401
- **THEN** one audit row is written with status 401 and empty or unknown username, without storing the presented password

#### Scenario: Secrets excluded from audit

- **WHEN** `POST /admin/users` creates a user with a password in the body
- **THEN** the audit row contains method/path/status metadata and does not contain the password string or `Authorization` value

#### Scenario: Platform surface tagged

- **WHEN** an authenticated platform admin calls any `/platform/*` management route
- **THEN** the request-level audit row has `surface: platform`

### Requirement: Request-level audit query API

The system MUST expose `GET /admin/audit-logs` and `GET /platform/audit-logs` for request-level rows (distinct from the chained mutation log at `GET /platform/audit-log`). Access MUST require role `admin`. Response shape MUST be `{ total, limit, offset, rows }` ordered by `created_at` descending, with `limit` default 50 max 200, `offset` default 0, and optional filters `username`, `from`/`to` on `created_at`, and `path` prefix or exact match as implemented consistently on both surfaces.

#### Scenario: Admin queries audit logs

- **WHEN** an authenticated admin calls `GET /admin/audit-logs?limit=50`
- **THEN** the response is HTTP 200 with paginated request-level rows including username, role, method, path, status, costMs, clientIp, createdAt

#### Scenario: Operator denied audit query

- **WHEN** an authenticated operator calls `GET /admin/audit-logs`
- **THEN** the system returns HTTP 403 with `errCode: AUTH_FORBIDDEN`

#### Scenario: Platform audit-logs path

- **WHEN** an authenticated platform admin calls `GET /platform/audit-logs`
- **THEN** only control-plane request-level rows are listed (not tenant data-plane rows, and not as a replacement for `GET /platform/audit-log` hash-chain query)

### Requirement: Management identity error codes

Management identity and user APIs MUST use string `errCode` values in error bodies (Nest admin/platform style), including at least:

| errCode | When |
|---|---|
| `AUTH_UNAUTHORIZED` | Missing/invalid Basic Auth, disabled user, or no matching DB user (HTTP 401) |
| `AUTH_FORBIDDEN` | Authenticated but role insufficient or IP policy already passed and role blocks (HTTP 403 for role); IP allowlist failures remain HTTP 403 as today |
| `USER_NOT_FOUND` | User id does not exist on this surface (HTTP 404) |
| `USER_USERNAME_TAKEN` | Create/update would violate username uniqueness (HTTP 409) |
| `USER_ROLE_INVALID` | `roleCode` not present in `admin_role` (HTTP 400) |
| `LAST_ADMIN_FORBIDDEN` | Disable or demote would remove the last enabled admin (HTTP 409) |
| `BOOTSTRAP_REQUIRED` | Optional explicit signal when zero enabled admins exist and bootstrap has not completed (HTTP 401 or 503 as documented by implementers; login still fails closed) |

#### Scenario: Unauthorized body carries errCode

- **WHEN** Basic Auth fails for a management route
- **THEN** the JSON error includes `errCode: AUTH_UNAUTHORIZED`

#### Scenario: Last admin disable carries errCode

- **WHEN** disable of the last enabled admin is attempted
- **THEN** the JSON error includes `errCode: LAST_ADMIN_FORBIDDEN`
