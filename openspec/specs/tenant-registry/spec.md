# tenant-registry Specification

## Purpose

定义多租户交付的租户元数据、生命周期状态机与实例编排（docker compose）规则，使平台运营方能够通过控制面完成租户开通、续期、暂停、恢复与销毁，而无需手工操作服务器。

## Requirements

### Requirement: Tenant creation

The system MUST provide `POST /platform/tenants` accepting a JSON body `{name, contact, plan, subscriptionExpiresAt?}` that creates a `tenant` row with status `created` and returns HTTP 201 with the full tenant row. `name` MUST be non-empty and unique among non-terminated tenants; a duplicate name MUST return HTTP 409. When `subscriptionExpiresAt` is omitted it MUST default to `now + 365 days`. Creating a tenant MUST write a `provision`-related audit entry via the `platform-audit` capability.

#### Scenario: Successful creation

- **WHEN** an operator posts `{name: "客户A", contact: "a@example.com", plan: "standard"}`
- **THEN** the system returns HTTP 201 with `{status: "created", subscriptionExpiresAt: <now+365d>}` and one `tenant` row exists

#### Scenario: Duplicate name rejected

- **WHEN** an operator posts a `name` equal to an existing non-terminated tenant
- **THEN** the system returns HTTP 409 and no row is created

#### Scenario: Missing required field

- **WHEN** an operator posts `{contact: "a@example.com"}` without `name`
- **THEN** the system returns HTTP 400 naming the missing field

### Requirement: Tenant lifecycle state machine

The system MUST enforce tenant status transitions `created → provisioning → active`, `active → grace`, `grace → paused`, `paused|grace|active → terminated`, `provisioning → provisioning_failed`, and `provisioning_failed → provisioning` (retry). Any other transition MUST return HTTP 409 with the current status in the error body. Terminal states `terminated` MUST accept no further transitions.

#### Scenario: Full happy-path lifecycle

- **WHEN** an operator drives a tenant through provision and then terminate
- **THEN** the statuses observed are `created → provisioning → active → terminated` in order

#### Scenario: Illegal transition rejected

- **WHEN** an operator calls suspend on a tenant in `created` status
- **THEN** the system returns HTTP 409 naming both the attempted action and the current status

#### Scenario: Retry after provisioning failure

- **WHEN** provision fails once (`provisioning_failed`) and the operator calls provision again
- **THEN** the tenant re-enters `provisioning` and, on success, `active`

### Requirement: Provisioning via docker compose

The system MUST provision a tenant instance by rendering a per-tenant compose file from a template under `PLATFORM_COMPOSE_DIR` (default `data/tenants/<tenantId>/docker-compose.yml`) and running `docker compose up -d` in that directory.

#### Scenario: Compose file is rendered per tenant

- **WHEN** provision runs for tenant `t-1`
- **THEN** `data/tenants/t-1/docker-compose.yml` exists and contains tenant-specific project name, port mapping, and volume paths

#### Scenario: Compose project name isolates tenants

- **WHEN** two tenants are provisioned
- **THEN** each `docker compose` invocation uses a distinct `-p` project name so no container or network is shared between tenants

### Requirement: Provision health probe and persistence

After `docker compose up -d` succeeds, the system MUST probe the instance's health endpoint until it reports healthy or a configurable timeout (`PLATFORM_PROVISION_TIMEOUT_MS`, default 120s) elapses. On success the system MUST persist the assigned `instance_host`, `instance_port`, `compose_file_path`, and `db_name` onto the tenant row and set status `active`.

#### Scenario: Successful provision

- **WHEN** provision runs for a tenant and the instance health probe succeeds within the timeout
- **THEN** the tenant row carries the instance host/port and compose file path, and status becomes `active`

#### Scenario: Health probe timeout

- **WHEN** the instance does not report healthy within the configured timeout after `docker compose up -d` succeeds
- **THEN** the system runs `docker compose down` for that project, sets status `provisioning_failed` with a probe-timeout error, and no containers of that project remain running

### Requirement: Provision failure handling

On compose command failure the system MUST set status `provisioning_failed`, record the error message (the command's stderr tail) on the tenant row, and not retry automatically.

#### Scenario: Compose command fails

- **WHEN** `docker compose up -d` exits non-zero
- **THEN** status becomes `provisioning_failed` with the stderr tail stored, and the method returns without retrying automatically

#### Scenario: Provision failure is visible on detail

- **WHEN** an operator calls `GET /platform/tenants/<id>` after a failed provision
- **THEN** the response includes status `provisioning_failed` and the stored error message

### Requirement: Suspend, resume, and terminate orchestration

The system MUST implement suspend as `docker compose stop` plus status `paused`, resume as `docker compose start` plus status `active` (only from `paused`), and terminate as `docker compose down -v` plus dropping the tenant's database plus status `terminated`. Each operation MUST be idempotent at the status-machine level (repeating a terminated tenant's terminate returns HTTP 200 without re-running compose). Suspend MUST be rejected with HTTP 409 for a tenant not in `active` or `grace` status.

#### Scenario: Suspend stops the instance

- **WHEN** suspend runs for an `active` tenant
- **THEN** `docker compose stop` executes in the tenant's compose directory and status becomes `paused`

#### Scenario: Resume restarts the instance

- **WHEN** resume runs for a `paused` tenant
- **THEN** `docker compose start` executes and status becomes `active`

#### Scenario: Terminate removes everything

- **WHEN** terminate runs for a `paused` tenant
- **THEN** `docker compose down -v` executes, the tenant database is dropped, status becomes `terminated`, and a later identical terminate returns HTTP 200 without invoking compose again

#### Scenario: Suspend a non-active tenant

- **WHEN** suspend is called for a tenant in `created` status
- **THEN** the system returns HTTP 409 and no compose command runs

### Requirement: Renewal extends subscription

The system MUST provide `POST /platform/tenants/:id/renew` accepting `{days: <positive int>}` (or `{subscriptionExpiresAt}`) that extends `subscription_expires_at` by the given days and returns the updated row. Renewal is allowed from `active` or `grace` status; from `grace` it MUST move the tenant back to `active`. Renewal MUST be rejected with HTTP 409 for `paused`, `terminated`, or in-flight `provisioning` tenants. Each renewal MUST write an audit entry.

#### Scenario: Renew an active tenant

- **WHEN** renew with `{days: 90}` is called on an `active` tenant expiring in 10 days
- **THEN** `subscription_expires_at` moves to 100 days from now and status stays `active`

#### Scenario: Renew rescues a grace tenant

- **WHEN** renew with `{days: 30}` is called on a tenant in `grace`
- **THEN** `subscription_expires_at` extends and status becomes `active`

#### Scenario: Renew a paused tenant rejected

- **WHEN** renew is called on a `paused` tenant
- **THEN** the system returns HTTP 409 and `subscription_expires_at` is unchanged

### Requirement: Expiry sweep to grace and pause

The system MUST run a scheduled sweep (default every hour, configurable) that moves `active` tenants whose `subscription_expires_at` has passed into `grace`, and `grace` tenants more than 7 days past expiry into `paused`. A `paused` tenant more than 30 days past expiry MUST be flagged in the sweep output for operator termination but MUST NOT be auto-terminated. Each automatic transition MUST write an audit entry with actor `system:sweep`.

#### Scenario: Active tenant expires

- **WHEN** the sweep runs and a tenant's expiry passed 1 day ago
- **THEN** the tenant status becomes `grace` and an audit entry with actor `system:sweep` exists

#### Scenario: Grace tenant past 7 days pauses

- **WHEN** the sweep runs and a `grace` tenant's expiry passed 8 days ago
- **THEN** the tenant status becomes `paused`

#### Scenario: Long-paused tenant flagged not terminated

- **WHEN** the sweep runs and a `paused` tenant's expiry passed 40 days ago
- **THEN** the tenant stays `paused` and is included in the sweep's flag list

### Requirement: Tenant listing and detail

The system MUST provide `GET /platform/tenants` returning `{total, limit, offset, rows}` ordered by `created_at` descending with `limit` (default 50, max 200), `offset`, and optional `status` filter; and `GET /platform/tenants/:id` returning the full tenant row including quota and current-day usage summary.

#### Scenario: Default listing

- **WHEN** an operator calls `GET /platform/tenants` with no parameters on 8 tenants
- **THEN** the response has `total: 8` and rows newest-first

#### Scenario: Status filter

- **WHEN** an operator calls `GET /platform/tenants?status=active` when 3 of 8 tenants are active
- **THEN** the response contains exactly those 3 rows and `total: 3`

#### Scenario: Unknown tenant id

- **WHEN** an operator calls `GET /platform/tenants/nonexistent`
- **THEN** the system returns HTTP 404

### Requirement: Provisioner interface substitution

The system MUST define provisioning, suspend, resume, and terminate behind a single provisioner interface, with the docker compose implementation as the default binding. Tests and future orchestration backends MUST be able to substitute the implementation without changing the tenant service's behavior contract.

#### Scenario: Interface-backed default

- **WHEN** the platform module initializes without an explicit provisioner binding
- **THEN** the docker compose implementation is used for all lifecycle operations

#### Scenario: Substituted provisioner in tests

- **WHEN** a test injects an in-memory provisioner and drives provision
- **THEN** the tenant status transitions identically to the docker compose path with no docker invocation
