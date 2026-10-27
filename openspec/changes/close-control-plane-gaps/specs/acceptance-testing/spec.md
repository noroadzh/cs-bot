# Spec Delta: acceptance-testing

## ADDED Requirements

### Requirement: Multi-tenant control-plane E2E

Acceptance MUST cover control-plane to tenant-instance data flow: quota/state push, usage report ingestion, TLS-aware health probe, and per-tenant backup, using fake docker or a real environment.

#### Scenario: Push and report round-trip

- **WHEN** the acceptance suite provisions two tenants with fake docker
- **THEN** quota/state push reaches both instances and reported usage is visible in the control plane

#### Scenario: Real environment optional

- **WHEN** network and a Docker host are available
- **THEN** the same flow can run against real tenant containers
