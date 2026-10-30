# Spec Delta

## MODIFIED Requirements

### Requirement: Per-tenant resource hard limits

Every rendered tenant compose MUST declare a memory limit for each of its six services. The `standard` plan MUST stay within the 4C8G budget. The `enhanced` plan MUST stay within the 8C16G budget.

#### Scenario: Rendered compose is bounded

- **WHEN** the control plane renders a tenant compose file
- **THEN** each of nginx, adapter, fastgpt, pg, mongo, and redis declares `mem_limit`

#### Scenario: Standard plan stays within the standard profile

- **WHEN** the tenant plan is `standard` or empty
- **THEN** the summed memory limits do not exceed 6500 MB

#### Scenario: Enhanced plan uses the larger profile

- **WHEN** the tenant plan is `enhanced`
- **THEN** the summed memory limits are greater than the standard profile and do not exceed 16384 MB
