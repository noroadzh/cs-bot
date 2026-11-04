## MODIFIED Requirements

### Requirement: TLS certificate provisioning

The system MUST request or issue a TLS certificate for the tenant domain. Modes MUST include dedicated per-tenant certificate and wildcard-certificate with SNI: in wildcard mode, provision MUST attach the tenant hostname to an SNI-capable nginx (or equivalent) configuration that references the shared wildcard material without requiring a unique ACME run per tenant. Certificate issuance or SNI attach failure MUST fail the provision and roll back. Dedicated subdomain mode MAY keep per-tenant cert files as today.

#### Scenario: TLS issued

- **WHEN** provision runs for a tenant
- **THEN** the tenant domain has a valid certificate bound to its instance

#### Scenario: Wildcard SNI attach on provision

- **WHEN** TLS mode is wildcard and provision runs for tenant host `t1.saas.example`
- **THEN** the instance edge config serves that host via SNI using the shared wildcard certificate material
