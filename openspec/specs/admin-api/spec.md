# admin-api Specification

## Purpose
Exposes management endpoints (miss-record export, keyword reload, config check, license status) under Basic Auth + IP whitelist so operators can monitor and tune the bot without SSH access.

## Requirements


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

### Requirement: Masked config check
The system MUST expose `GET /admin/config-check` that returns the presence status of every required environment variable with the value masked (e.g., `ww12****ef78`).

#### Scenario: All required vars present
- **WHEN** every required env var is set
- **THEN** the response shows `{key, present: true, masked}` for each var

#### Scenario: Missing var
- **WHEN** any required env var is missing
- **THEN** the response includes `{key, present: false}` for that var

### Requirement: License status endpoint
The system MUST expose `GET /admin/license` returning `{valid, reason?, expiresAt?, daysLeft?, maxChats, fingerprint, mock}`.

#### Scenario: License valid in mock mode
- **WHEN** the mock verifier returns a valid state
- **THEN** the endpoint includes `mock: true` and `reason: 'mock'`

### Requirement: Config hot reload
The system MUST expose `POST /admin/config/reload` that re-reads all reloadable env vars and mutable config files (keywords, sensitive-words) without restarting the adapter.

#### Scenario: Reload updates effective config
- **WHEN** an admin posts to `/admin/config/reload`
- **THEN** subsequent pipeline messages use the new thresholds and word lists, and the response reports which keys were reloaded

### Requirement: Asset management endpoints

The system MUST expose `POST /admin/assets`, `GET /admin/assets`, and `DELETE /admin/assets/:id` under Basic Auth + IP whitelist protection, as defined in the `media-management` capability.

#### Scenario: Create asset via POST
- **WHEN** an operator posts a file to `POST /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 201 with the created asset's metadata

#### Scenario: List assets via GET
- **WHEN** an operator calls `GET /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 200 with a paginated list of assets

#### Scenario: Delete asset via DELETE
- **WHEN** an operator sends `DELETE /admin/assets/:id` with valid Basic Auth
- **THEN** the system returns HTTP 200 on success or HTTP 404 if not found

### Requirement: Usage reporting endpoint

The system MUST expose `GET /admin/usage` under Basic Auth + IP whitelist protection, returning the current period's usage counters as defined in the `usage-reporting` capability.

#### Scenario: Query usage
- **WHEN** an operator calls `GET /admin/usage` with valid Basic Auth
- **THEN** the system returns HTTP 200 with the usage counters and period info

#### Scenario: Query usage with period parameter
- **WHEN** an operator calls `GET /admin/usage?period=weekly` with valid Basic Auth
- **THEN** the system returns HTTP 200 with the weekly aggregation

### Requirement: Response DTO declarations

The system MUST declare OpenAPI response schemas for every 2xx response on management
endpoints (`/admin/*`, `/healthz`, `/wecom/*`), so that the generated OpenAPI document
exposes the actual return shape rather than empty schemas.

#### Scenario: DTO class with ApiProperty

- **WHEN** a controller method returns a typed object for a 2xx response
- **THEN** a Response DTO class exists under `apps/adapter/src/{common,admin,media}/dto/`
  with every persisted field annotated by `@ApiProperty()`

#### Scenario: Controller declares type on ApiResponse

- **WHEN** a controller method is decorated with `@ApiResponse({ status: 2xx })`
- **THEN** that decoration MUST include either `type:` (pointing to a DTO class) or
  `schema:` (inline schema, allowed only for primitive / callback responses)

#### Scenario: Primitive callback responses

- **WHEN** a controller returns a primitive body (e.g. WeCom callback's plain-text
  `echostr` acknowledgement)
- **THEN** the `@ApiResponse` uses `schema: { type: 'string' }` rather than a DTO class

### Requirement: Swagger contract regression test

The system MUST include a test that fails CI if any controller handler drops its
OpenAPI response declaration or any DTO property loses its `@ApiProperty()` annotation.

#### Scenario: Every handler has ApiOperation

- **WHEN** the test reflects over every controller method in `admin/`, `media/`,
  `wecom/`, `health/`
- **THEN** each method MUST be decorated with `@ApiOperation()`

#### Scenario: Every 2xx response is declared

- **WHEN** the test enumerates `@ApiResponse` metadata on each handler
- **THEN** every status code in the 2xx range MUST carry a `type` or `schema` field

#### Scenario: Referenced DTOs expose their fields

- **WHEN** the test resolves each DTO class referenced by an `@ApiResponse`
- **THEN** the DTO's own properties MUST each carry an `@ApiProperty()` annotation

### Requirement: OpenAPI document is served at runtime

The system MUST serve the OpenAPI document and a Swagger UI when `SWAGGER_ENABLED=true`,
and MUST publish the raw OpenAPI JSON at a path that does not collide with the
SwaggerModule's internal `/docs-json` route.

#### Scenario: Swagger UI mounted when enabled

- **WHEN** the bootstrap reads `SWAGGER_ENABLED=true` from config
- **THEN** `SwaggerModule.setup` is called with the configured UI path
  (default `/docs`) and the generated document

#### Scenario: OpenAPI JSON exposed separately

- **WHEN** a client requests the configured OpenAPI JSON path
  (default `/docs/openapi.json`)
- **THEN** the response is the raw OpenAPI document (not HTML, not wrapped)
  and the path is a sibling of the UI path so both share a common prefix

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
