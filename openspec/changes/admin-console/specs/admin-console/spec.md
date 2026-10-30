# Spec Delta

## ADDED Requirements

### Requirement: Tenant console calls only existing admin APIs

The data-plane process MUST serve the tenant console at `/console` when its static directory exists, and MUST NOT mount that console when the directory is absent. The tenant console MUST call only existing `/admin/*` routes for miss records, assets, import jobs, license, usage, config check, config reload, and keyword reload. It MUST NOT add or change those routes.

#### Scenario: Missing static directory

- **WHEN** the tenant console directory does not exist and `ADMIN_CONSOLE_DIR` is unset or points at a missing path
- **THEN** the data-plane process starts without serving `/console` and the WeCom callback path is unchanged

#### Scenario: Operator downloads miss records

- **WHEN** an operator opens the miss list and requests the spreadsheet
- **THEN** the browser calls `GET /admin/miss-records` with `format=xlsx` and the existing Basic Auth header

### Requirement: Platform console calls only existing platform APIs

The control-plane process MUST serve the platform console at `/console` when its static directory exists. The platform console MUST call only existing `/platform/*` routes. The console MUST NOT open a shell terminal.

#### Scenario: Mutation without a reason

- **WHEN** an operator submits a platform change with an empty reason
- **THEN** the console does not send the request and shows that a reason is required

#### Scenario: Destroy keeps dual approval

- **WHEN** an operator destroys a tenant from the console
- **THEN** the request includes two distinct approvals, the one-time confirmToken, and a non-empty reason

#### Scenario: Control plane disabled

- **WHEN** the control-plane process is not started
- **THEN** the platform console static files are not mounted by the data-plane process

### Requirement: Console login keeps Basic Auth and the IP allowlist

The console MUST store the operator account and password in `sessionStorage` and send them as `Authorization: Basic` on API requests. It MUST NOT add a login route and MUST NOT relax the existing IP allowlist. A 401 response MUST clear the stored credentials and show the login form. Passwords, license material, and secret values MUST NOT be written to console logs.

#### Scenario: Unauthorized response

- **WHEN** an admin request returns 401
- **THEN** the stored credentials are cleared and the operator sees the login form
