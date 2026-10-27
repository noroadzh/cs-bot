# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Per-tenant backup

The daily backup MUST include every provisioned tenant instance: PostgreSQL dump, MongoDB dump, and tenant data directory, retaining the configured window per tenant.

#### Scenario: Tenant backup produced

- **WHEN** the daily backup runs with active tenants
- **THEN** each tenant has pg/mongo/data artifacts in its backup directory

#### Scenario: Failed tenant isolated

- **WHEN** one tenant backup fails
- **THEN** the failure is logged and other tenants still complete
