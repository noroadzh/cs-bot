## MODIFIED Requirements

### Requirement: Basic Auth with IP whitelist

The system MUST require HTTP Basic Auth credentials that match an **enabled database** `admin_user` (password verified against `password_hash`) AND require the source IP to fall within `ALLOWED_ADMIN_IPS` (CIDR list) for every `/admin/*` management endpoint. Legacy environment credentials (`ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_OPERATOR_*`) MUST NOT authenticate (**BREAKING**). The source IP MUST be the socket peer address by default. Forwarded client-IP headers (`X-Forwarded-For`, `X-Real-IP`) MUST be honored only when the socket peer belongs to `TRUSTED_PROXY_CIDRS` (default loopback), and then the effective client is the first address in `X-Forwarded-For` that is not itself a trusted proxy, falling back to `X-Real-IP`. Forwarded headers from an untrusted peer MUST be ignored. Successful auth MUST attach `userId`, `username`, and `role_code` for `RolesGuard` and request-level audit as defined by `admin-identity`.

`/healthz` MAY remain reachable without management Basic Auth as defined by `deployment-suite`; when `/healthz` is covered by the same IP policy as today, that policy MUST NOT regress. Static console assets are outside this requirement's credential check unless they invoke `/admin/*` APIs.

#### Scenario: Valid auth from whitelisted IP

- **WHEN** a request comes from an IP in `ALLOWED_ADMIN_IPS` with Basic Auth matching an enabled DB user
- **THEN** the request reaches the handler with that user's role attached

#### Scenario: Wrong IP

- **WHEN** a request comes from an IP outside `ALLOWED_ADMIN_IPS`
- **THEN** the system returns HTTP 403 regardless of credentials

#### Scenario: Wrong password

- **WHEN** credentials do not match any enabled `admin_user` password hash
- **THEN** the system returns HTTP 401 with `WWW-Authenticate: Basic` and `errCode: AUTH_UNAUTHORIZED`

#### Scenario: Env password rejected

- **WHEN** the client sends Basic Auth equal to configured `ADMIN_USER`/`ADMIN_PASSWORD` but no DB user exists for that username (or the password only matches the env value)
- **THEN** the system returns HTTP 401 with `errCode: AUTH_UNAUTHORIZED`

#### Scenario: Reverse proxy forwards the real client IP

- **WHEN** the nginx container (inside `TRUSTED_PROXY_CIDRS`) forwards a request from a whitelisted operator IP with `X-Forwarded-For`
- **THEN** the whitelist check evaluates the operator IP and admits the request

#### Scenario: Spoofed forwarded header ignored

- **WHEN** a direct client outside `TRUSTED_PROXY_CIDRS` sends `X-Forwarded-For: 127.0.0.1`
- **THEN** the system evaluates the socket peer address and returns HTTP 403 when it is not whitelisted

## ADDED Requirements

### Requirement: Admin user management endpoints

The data-plane management API MUST expose the user CRUD surface defined by `admin-identity` at:

- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id`
- `POST /admin/users/:id/disable`

These routes MUST use the same Basic Auth + IP whitelist gate as other `/admin/*` routes and MUST require role `admin`. Response DTOs MUST omit password material and MUST be declared for OpenAPI 2xx responses like other admin endpoints.

#### Scenario: Create user via admin API

- **WHEN** an admin posts a valid body to `POST /admin/users`
- **THEN** the system returns HTTP 201 with the created user metadata (no password)

#### Scenario: Disable user via admin API

- **WHEN** an admin posts to `POST /admin/users/:id/disable` for a non-last admin or any operator
- **THEN** the user becomes `enabled=false` and subsequent Basic Auth for that user returns 401

### Requirement: Admin request-level audit-logs endpoint

The data-plane management API MUST expose `GET /admin/audit-logs` returning paginated request-level audit rows as defined by `admin-identity`. The endpoint MUST require role `admin` and MUST NOT return password or Authorization material.

#### Scenario: List audit logs

- **WHEN** an authenticated admin calls `GET /admin/audit-logs`
- **THEN** the system returns HTTP 200 with `{ total, limit, offset, rows }` of request-level entries

#### Scenario: Operator forbidden

- **WHEN** an authenticated operator calls `GET /admin/audit-logs`
- **THEN** the system returns HTTP 403 with `errCode: AUTH_FORBIDDEN`

### Requirement: Every admin API call is request-audited

Every `/admin/*` controller invocation that passes through the management HTTP stack MUST produce a request-level audit row (see `admin-identity`), including reads and authorization failures, without recording secrets.

#### Scenario: Config check produces an audit row

- **WHEN** an authenticated operator calls `GET /admin/config-check`
- **THEN** exactly one request-level audit row is written for that call with status 200
