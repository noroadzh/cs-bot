## MODIFIED Requirements

### Requirement: Self-serve registration and billing

The control plane MUST provide self-serve tenant registration (email verification MAY be placeholder), WeChat/Alipay payment configuration via environment variables, and renew orders persisted in durable storage. When payment credentials are absent, a mock/sandbox channel MUST still allow marking an order paid. Successful payment MUST call the existing tenant renew flow and record a billing audit entry. Real WeChat/Alipay SDK integration is optional until configured.

#### Scenario: Paid renew extends subscription

- **WHEN** payment for a renew order succeeds (including mock/sandbox pay)
- **THEN** the control plane persists the order as paid, invokes tenant renew for the paid days, and records a billing audit entry

#### Scenario: Order durable across process restart

- **WHEN** a renew order is created
- **THEN** it is stored in the control-plane database (not only process memory) and can be loaded by id afterward

### Requirement: Shared tenancy mode

Tenant provisioning MUST accept `tenancy_mode=dedicated|shared`. Shared mode runs logical isolation keyed by `tenant_id` for miss/asset/import rows and Redis key prefixes on the data plane. Dedicated mode keeps per-tenant compose isolation. Data-plane instances MUST stamp and filter by env `TENANT_ID` (empty means unbound private deployment). New tenants MAY default to dedicated. Request-scoped multi-tenant ALS in one process is out of scope for this requirement.

#### Scenario: Shared tenant gets tenant_id isolation

- **WHEN** a data-plane instance has `TENANT_ID` set (as for a shared or dedicated provisioned tenant)
- **THEN** its miss/asset/import writes and reads are scoped to that tenant id and Redis keys use a tenant-specific prefix so they do not collide with another tenant id
