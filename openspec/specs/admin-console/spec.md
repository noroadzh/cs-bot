# admin-console Specification

## Purpose
租户运营台与 `/admin/*` 的角色分级、用量看板与 FastGPT 知识库代理页面，使运营可在不直连 FastGPT 存储的前提下完成日常运维。

## Requirements


### Requirement: Role-based console access

The tenant console (`/console` on the data plane) and platform console MUST authenticate with HTTP Basic Auth against **database** management users (`admin-identity`), not environment dual accounts. Consoles and `/admin/*` / `/platform/*` routes MUST distinguish at least `operator` and `admin` roles from `admin_user.role_code`. Operators MAY manage miss records, assets, import review, and knowledge proxy pages. Admins MAY additionally change license reload, sensitive-word/keyword reload, and user/role assignments, and MAY open user-management and full audit-log pages. Unauthenticated requests MUST receive 401 (`AUTH_UNAUTHORIZED`). The console MUST keep storing credentials in `sessionStorage` and sending `Authorization: Basic` on API requests; it MUST NOT add OAuth/SSO login routes and MUST NOT relax the IP allowlist.

#### Scenario: Operator denied license reload

- **WHEN** an operator calls `POST /admin/license/reload`
- **THEN** the response is 403 with `errCode: AUTH_FORBIDDEN`

#### Scenario: DB user login from console

- **WHEN** an operator signs in with a username/password that matches an enabled DB user
- **THEN** subsequent API calls succeed with Basic Auth and env-only legacy passwords do not

#### Scenario: Unauthorized response clears credentials

- **WHEN** an admin request returns 401
- **THEN** the stored credentials are cleared and the operator sees the login form

### Requirement: Usage dashboard

The system MUST expose `GET /admin/stats/overview` returning question volume, hit rate, refusal rate, top unanswered questions, and per-chat activity for a selectable period. The tenant console MUST render these metrics on a dashboard page. Acceptance MUST include an end-to-end check that the dashboard page loads counters from this API for at least the daily period.

#### Scenario: Overview returns aggregate counters

- **WHEN** an authenticated user calls `GET /admin/stats/overview?period=daily`
- **THEN** the response includes numeric fields for messages, hits, refusals, and a top-miss list

#### Scenario: Dashboard page binds overview API

- **WHEN** an authenticated operator opens the console dashboard
- **THEN** the page displays overview metrics sourced from `/admin/stats/overview`

### Requirement: Knowledge proxy pages

The data plane MUST proxy FastGPT dataset/document APIs under `/admin/knowledge/*` via `FastGPTClient` only (no direct Mongo/pgvector). The tenant console MUST provide upload and collection status UI that calls these routes, and MUST support one-click miss-to-knowledge ingest that uses the same proxy path. Acceptance MUST include a joint test covering list → one-click ingest → collection status refresh.

#### Scenario: Knowledge list uses FastGPTClient

- **WHEN** an admin lists knowledge collections
- **THEN** the adapter calls FastGPT through `FastGPTClient` and returns the proxied result

#### Scenario: One-click miss ingest via proxy

- **WHEN** an operator triggers one-click ingest for an approved miss or learning suggestion
- **THEN** the adapter writes through `FastGPTClient` and the knowledge UI can refresh collection status afterward

### Requirement: Quality inspection console page

The tenant admin-web MUST provide a `/quality` page that lists recent inspections and active threshold breaches and MUST allow submitting a manual quality-check sample via the admin API.

#### Scenario: Quality page loads inspections

- **WHEN** an authenticated operator opens `/quality`
- **THEN** the page displays items from `GET /admin/archive/quality-inspections`

#### Scenario: Manual sample from UI

- **WHEN** the operator submits a sample on `/quality`
- **THEN** the UI calls `POST /admin/archive/quality-check` and refreshes the list using the returned `inspectionId` / alerts

### Requirement: Archive operations console page

The tenant admin-web MUST provide `/archive` listing archive-linked import jobs and pull state, with an action to trigger a one-shot pull when pull is enabled.

#### Scenario: Archive page loads jobs

- **WHEN** an authenticated operator opens `/archive`
- **THEN** the UI loads archive job/pull-state APIs with Basic Auth

#### Scenario: Trigger pull from UI

- **WHEN** the operator triggers pull on `/archive`
- **THEN** the UI calls the admin pull endpoint and shows async status without blocking the SPA

### Requirement: Self-serve billing console

The platform (or dedicated self-serve) admin-web surface MUST expose `/register`, `/billing`, and `/billing/orders/:id` calling control-plane self-serve APIs. Mock channel MUST offer an explicit simulate-pay action calling the existing mock pay endpoint. When self-serve is disabled, the UI MUST surface the API `errCode`.

#### Scenario: Register then create order

- **WHEN** a user completes register on `/register`
- **THEN** the UI shows `tenantId` and can navigate to order creation on `/billing`

#### Scenario: Mock pay from UI

- **WHEN** the order channel is mock
- **THEN** simulate-pay succeeds and the UI polls order status until `paid`

### Requirement: User management console pages

Both tenant and platform admin-web surfaces MUST provide a Users page that calls the corresponding user APIs (`/admin/users*` or `/platform/users*`). The page MUST allow an `admin` to list users, create users (username, password, role), update role/password, and disable users. The Users menu entry and mutating actions MUST be hidden or disabled for `operator`. Passwords MUST NOT be written to console logs.

#### Scenario: Admin opens users page

- **WHEN** an authenticated admin opens the Users page on the tenant console
- **THEN** the UI loads `GET /admin/users` and renders the user list without password fields

#### Scenario: Admin creates operator from UI

- **WHEN** an admin submits create-user on the Users page with role `operator`
- **THEN** the UI calls `POST /admin/users` (or `/platform/users` on the platform surface) and refreshes the list on success

#### Scenario: Operator cannot open users management

- **WHEN** an authenticated operator views the console navigation
- **THEN** the Users management entry is not offered (or navigations receive 403 from the API)

### Requirement: Audit log console pages

Both tenant and platform admin-web surfaces MUST provide an Audit page that calls `GET /admin/audit-logs` or `GET /platform/audit-logs` respectively. The page MUST be limited to `admin` role and MUST display request-level fields (time, username, role, method, path, status, cost, IP) without secret bodies. On the platform surface, this page is **in addition to** any existing chained mutation audit views (`/platform/audit-log`); it MUST NOT replace reason/hash-chain audit UX for dangerous mutations.

#### Scenario: Admin opens audit page

- **WHEN** an authenticated admin opens the Audit page on the tenant console
- **THEN** the UI loads `GET /admin/audit-logs` and shows recent request-level rows

#### Scenario: Platform audit page uses platform path

- **WHEN** an authenticated platform admin opens the request-level Audit page
- **THEN** the UI calls `GET /platform/audit-logs` and does not omit the separate mutation hash-chain audit flow

#### Scenario: Operator denied audit page

- **WHEN** an authenticated operator attempts to open the Audit page
- **THEN** the menu hides it or the API returns 403 and the UI surfaces the denial
