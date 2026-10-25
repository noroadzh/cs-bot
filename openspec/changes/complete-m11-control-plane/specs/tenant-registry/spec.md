# Spec Delta: tenant-registry

## MODIFIED Requirements

### Requirement: Tenant lifecycle state machine

The system MUST enforce subscription status transitions `trialing → active → grace → suspended → terminated`, plus `created → provisioning → active`, `provisioning → provisioning_failed`, and `provisioning_failed → provisioning` (retry). It MUST treat legacy `paused` as an alias of `suspended`. Illegal transitions MUST return HTTP 409 with the current status. Terminal `terminated` MUST accept no further transitions.

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

## ADDED Requirements

### Requirement: Subscription expiry reminders

The system MUST send reminders to the tenant and the operations channel at T-30, T-15, and T-7 days before subscription expiry.

#### Scenario: Reminder sent

- **WHEN** a tenant is 30 days from expiry
- **THEN** a T-30 reminder is sent to the tenant and ops

### Requirement: Tenant offboarding and data export

The system MUST provide `POST /platform/tenants/:id/export` (encrypted package of knowledge base + assets + pg_dump + config) and `POST /platform/tenants/:id/destroy` requiring dual sign-off; destroy MUST delete instances/data/backups/certificates at T+7 and record a deletion confirmation.

#### Scenario: Export package produced

- **WHEN** an operator exports a tenant
- **THEN** an encrypted package containing KB, assets, pg_dump, and config is produced

#### Scenario: Destroy requires dual sign-off

- **WHEN** destroy is requested without a second approval
- **THEN** it is rejected; with dual sign-off, deletion proceeds and a confirmation is recorded
