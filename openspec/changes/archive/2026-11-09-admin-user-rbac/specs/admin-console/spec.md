## MODIFIED Requirements

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

## ADDED Requirements

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
