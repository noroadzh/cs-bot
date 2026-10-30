# Spec Delta

## ADDED Requirements

### Requirement: Per-tenant resource hard limits

Every rendered tenant compose MUST declare a memory limit for each of its six services, so that one tenant's growth cannot exhaust the shared host or starve other tenants.

#### Scenario: Rendered compose is bounded

- **WHEN** the control plane renders a tenant compose file
- **THEN** each of nginx, adapter, fastgpt, pg, mongo, and redis declares `mem_limit`

#### Scenario: Limits stay within the standard profile

- **WHEN** the rendered limits are summed
- **THEN** the total does not exceed the documented 4C8G standard budget
