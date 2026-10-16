# admin-api Specification

## Purpose
Exposes management endpoints (miss-record export, keyword reload, config check, license status) under Basic Auth + IP whitelist so operators can monitor and tune the bot without SSH access.

## Requirements

### Requirement: Basic Auth with IP whitelist
The system MUST require HTTP Basic Auth credentials matching `ADMIN_USER`/`ADMIN_PASSWORD` AND require the source IP to fall within `ALLOWED_ADMIN_IPS` (CIDR list) for every `/admin/*` and `/healthz` management endpoint.

#### Scenario: Valid auth from whitelisted IP
- **WHEN** a request comes from an IP in `ALLOWED_ADMIN_IPS` with correct Basic Auth
- **THEN** the request reaches the handler

#### Scenario: Wrong IP
- **WHEN** a request comes from an IP outside `ALLOWED_ADMIN_IPS`
- **THEN** the system returns HTTP 403 regardless of credentials

#### Scenario: Wrong password
- **WHEN** credentials do not match `ADMIN_USER`/`ADMIN_PASSWORD`
- **THEN** the system returns HTTP 401 with `WWW-Authenticate: Basic`

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
