# Spec Delta

## ADDED Requirements

### Requirement: Tenant admin console exposure control

The provisioned tenant FastGPT admin console MUST NOT be reachable from arbitrary public addresses by default. The rendered tenant nginx MUST either omit the admin listener or restrict it to `TENANT_ADMIN_ALLOW_CIDRS` (empty by default means disabled), deny all other sources, and the provisioning report MUST state whether the admin console is enabled and for which CIDRs.

#### Scenario: Admin console disabled by default

- **WHEN** a tenant is provisioned without `TENANT_ADMIN_ALLOW_CIDRS`
- **THEN** the tenant's admin port is not publicly reachable and the provisioning report says it is disabled

#### Scenario: Allowlisted CIDR reaches the console

- **WHEN** `TENANT_ADMIN_ALLOW_CIDRS=203.0.113.0/24` and a client in that range connects to the tenant admin port
- **THEN** nginx admits the request to FastGPT

#### Scenario: Non-allowlisted source denied

- **WHEN** a client outside `TENANT_ADMIN_ALLOW_CIDRS` connects to the tenant admin port
- **THEN** nginx returns HTTP 403 without proxying to FastGPT
