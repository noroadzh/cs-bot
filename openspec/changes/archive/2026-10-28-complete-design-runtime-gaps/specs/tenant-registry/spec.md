# Spec Delta

## MODIFIED Requirements

### Requirement: Renewal extends subscription

The system MUST provide `POST /platform/tenants/:id/renew` accepting `{days: <positive int>}` (or `{subscriptionExpiresAt}`) that extends `subscription_expires_at` by the given days and returns the updated row. Renewal is allowed from `active` or `grace` status; from `grace` it MUST move the tenant back to `active`. Renewal MUST be rejected with HTTP 409 for `paused`, `terminated`, or in-flight `provisioning` tenants. Each renewal MUST write an audit entry. Each renewal MUST also issue a replacement license bound to the tenant instance fingerprint and covering the new expiry, and make it available to the running instance through hot reload (restart is an acceptable fallback).

#### Scenario: Renew an active tenant

- **WHEN** renew with `{days: 90}` is called on an `active` tenant expiring in 10 days
- **THEN** `subscription_expires_at` moves to 100 days from now and status stays `active`

#### Scenario: Renew rescues a grace tenant

- **WHEN** renew with `{days: 30}` is called on a tenant in `grace`
- **THEN** `subscription_expires_at` extends and status becomes `active`

#### Scenario: Renewal reissues the instance license

- **WHEN** a renewal extends a tenant's subscription
- **THEN** a new license bound to that instance's fingerprint and the new expiry is issued and the instance serves with the extended expiry without being reprovisioned

#### Scenario: Renew a paused tenant rejected

- **WHEN** renew is called on a `paused` tenant
- **THEN** the system returns HTTP 409 and `subscription_expires_at` is unchanged

### Requirement: Tenant offboarding and data export

The system MUST provide `POST /platform/tenants/:id/export` producing an encrypted package of knowledge base + assets + pg_dump + config and issuing a one-time `confirmToken` bound to that tenant, and `POST /platform/tenants/:id/destroy` requiring dual sign-off plus a valid `confirmToken`. The package MUST be assembled from actual tenant data: the tenant FastGPT knowledge-base data (including documents and vectors), asset bytes, a tenant database dump, and configuration; an empty knowledge-base placeholder or asset name list alone does not satisfy this requirement. A successful destroy request MUST move the tenant to `offboarding`, set `destroy_scheduled_at` to seven days later, and return that schedule without deleting anything. A scheduled sweep MUST delete instances, data, backups, certificates, and secrets at or after `destroy_scheduled_at`, set status `terminated`, and record a deletion confirmation. Requests with fewer than two distinct approvals, or with a missing, expired, or already-used token, MUST be rejected without scheduling.

#### Scenario: Export package produced

- **WHEN** an operator exports a tenant
- **THEN** an encrypted package containing the tenant's actual KB data, asset bytes, a database dump, and config is produced, an audit entry is written, and a one-time confirm token is returned

#### Scenario: Export is not a placeholder

- **WHEN** the export package is decrypted
- **THEN** the KB section is non-empty when the tenant has knowledge, assets contain file content rather than names only, and the database dump can be restored

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
