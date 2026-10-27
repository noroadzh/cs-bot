# Spec Delta: platform-monitoring

## ADDED Requirements

### Requirement: TLS-aware instance probe

The platform monitor MUST probe tenant instances using the tenant's host and port and MUST support HTTPS with a configurable TLS verification policy.

#### Scenario: HTTPS tenant probed

- **WHEN** a tenant exposes only 443 via nginx with TLS
- **THEN** the probe reaches `https://<host>:<port>/healthz` and reports healthy

#### Scenario: TLS verification configurable

- **WHEN** the deployment uses self-signed certificates
- **THEN** an operator can disable certificate verification without changing code
