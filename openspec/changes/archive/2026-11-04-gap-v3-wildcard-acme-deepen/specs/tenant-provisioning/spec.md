## MODIFIED Requirements

### Requirement: TLS certificate provisioning

The system MUST request or issue a TLS certificate for the tenant domain. Modes MUST include dedicated per-tenant certificate and wildcard-certificate with SNI: in wildcard mode, provision MUST attach the tenant hostname to an SNI-capable nginx (or equivalent) configuration that references the shared wildcard material without requiring a unique ACME run per tenant. When `PLATFORM_TLS_MODE=wildcard`, the platform MUST obtain and renew the shared wildcard certificate for the configured base domain using ACME DNS-01 or an equivalent `PLATFORM_CERT_CMD` that performs DNS-01, writing material to the shared wildcard cert directory. Certificate issuance, renewal, or SNI attach failure MUST fail the related job and MUST NOT silently serve known-expired shared material without ops alert. Dedicated subdomain mode MAY keep per-tenant cert files as today.

#### Scenario: TLS issued

- **WHEN** provision runs for a tenant
- **THEN** the tenant domain has a valid certificate bound to its instance

#### Scenario: Wildcard SNI attach on provision

- **WHEN** TLS mode is wildcard and provision runs for tenant host `t1.saas.example`
- **THEN** the instance edge config serves that host via SNI using the shared wildcard certificate material

#### Scenario: Wildcard ACME DNS-01 material

- **WHEN** wildcard mode is enabled and DNS-01 credentials are valid
- **THEN** shared cert material exists under the wildcard directory and tenant provision only attaches SNI without per-tenant ACME
