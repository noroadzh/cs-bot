# Spec Delta: tenant-registry

## ADDED Requirements

### Requirement: Tenant reporting connectivity

Provisioned tenant instances MUST receive a reachable control-plane reporting URL and token, and their network MUST allow outbound access to it. The control plane MUST accept the report through the dedicated token authentication.

#### Scenario: Report reaches control plane

- **WHEN** a tenant instance runs its daily usage report
- **THEN** the control plane receives the counters over the shared network

#### Scenario: Tenant restarts

- **WHEN** a tenant container is recreated
- **THEN** the reporting URL/token remain injected from the tenant environment
