## ADDED Requirements

### Requirement: Self-serve registration and billing

The control plane MUST provide self-serve tenant registration (email verification), WeChat/Alipay payment configuration via environment variables, subscription and usage-based invoices, and renewal that calls the existing tenant renew flow after successful payment.

#### Scenario: Paid renew extends subscription

- **WHEN** payment for a renew order succeeds
- **THEN** the control plane invokes tenant renew for the paid days and records a billing audit entry

### Requirement: Shared tenancy mode

Tenant provisioning MUST accept `tenancy_mode=dedicated|shared`. Shared mode runs logical isolation in a shared adapter process keyed by `tenant_id` for miss/asset/import/redis. Dedicated mode keeps per-tenant compose isolation. New tenants MAY default to dedicated.

#### Scenario: Shared tenant gets tenant_id isolation

- **WHEN** a tenant is provisioned with `tenancy_mode=shared`
- **THEN** its data paths and redis key prefixes include that tenant id and do not read another tenant's rows
