# Spec Delta

## MODIFIED Requirements

### Requirement: Tenant lifecycle state machine

The system MUST enforce subscription status transitions `trialing → active → grace → suspended → terminated`, plus `created → provisioning → active`, `provisioning → provisioning_failed`, `provisioning_failed → provisioning` (retry), and offboarding transitions `active|grace|suspended → offboarding → terminated`. It MUST treat legacy `paused` as an alias of `suspended`. Illegal transitions MUST return HTTP 409 with the current status. A tenant in `offboarding` MUST reject renew, suspend, resume, and provision with HTTP 409. Terminal `terminated` MUST accept no further transitions.

#### Scenario: Full happy-path lifecycle

- **WHEN** an operator drives a tenant through provision and then terminate
- **THEN** the statuses observed are `created → provisioning → active → terminated` in order

#### Scenario: Grace to suspended

- **WHEN** a grace tenant is not renewed past the grace window
- **THEN** its status becomes `suspended`

#### Scenario: Legacy paused accepted

- **WHEN** an existing tenant has status `paused`
- **THEN** it is treated as `suspended` for transition checks

#### Scenario: Illegal transition rejected

- **WHEN** an operator calls suspend on a tenant in `created` status
- **THEN** the system returns HTTP 409 naming both the attempted action and the current status

#### Scenario: Retry after provisioning failure

- **WHEN** provision fails once (`provisioning_failed`) and the operator calls provision again
- **THEN** the tenant re-enters `provisioning` and, on success, `active`

#### Scenario: Offboarding blocks service changes

- **WHEN** an operator calls renew on a tenant in `offboarding`
- **THEN** the system returns HTTP 409 and the scheduled deletion is unchanged

### Requirement: Tenant offboarding and data export

The system MUST provide `POST /platform/tenants/:id/export` producing an encrypted package of knowledge base + assets + pg_dump + config and issuing a one-time `confirmToken` bound to that tenant, and `POST /platform/tenants/:id/destroy` requiring dual sign-off plus a valid `confirmToken`. A successful destroy request MUST move the tenant to `offboarding`, set `destroy_scheduled_at` to seven days later, and return that schedule without deleting anything. A scheduled sweep MUST delete instances, data, backups, certificates, and secrets at or after `destroy_scheduled_at`, set status `terminated`, and record a deletion confirmation. Requests with fewer than two distinct approvals, or with a missing, expired, or already-used token, MUST be rejected without scheduling.

#### Scenario: Export package produced

- **WHEN** an operator exports a tenant
- **THEN** an encrypted package containing KB, assets, pg_dump, and config is produced, an audit entry is written, and a one-time confirm token is returned

#### Scenario: Destroy requires dual sign-off

- **WHEN** destroy is requested with only one approval
- **THEN** it is rejected, the tenant keeps its status, and no deletion is scheduled

#### Scenario: Destroy schedules instead of deleting

- **WHEN** destroy is requested with two distinct approvals and a valid confirm token
- **THEN** the tenant becomes `offboarding`, `destroy_scheduled_at` is seven days later, and its containers, database, and backups still exist

#### Scenario: Repeated destroy is idempotent

- **WHEN** destroy is requested again before the scheduled time
- **THEN** the system returns HTTP 200 with the same schedule and changes nothing

#### Scenario: Sweep deletes at T+7 and records confirmation

- **WHEN** the sweep runs at or after a tenant's `destroy_scheduled_at`
- **THEN** its compose stack, database, backups, certificates, and secrets are deleted, its status becomes `terminated`, and a deletion confirmation record plus audit entry are written

#### Scenario: Token cannot be reused

- **WHEN** a confirm token that already scheduled another tenant's destroy is presented
- **THEN** the request is rejected and no second tenant is scheduled
