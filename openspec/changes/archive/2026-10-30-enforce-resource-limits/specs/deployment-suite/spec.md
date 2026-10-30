# Spec Delta

## ADDED Requirements

### Requirement: Per-service memory limits

The baseline compose MUST declare an explicit memory limit for every service, and Redis MUST run with `maxmemory` and an eviction policy so that one component's growth cannot exhaust the host and kill the others.

#### Scenario: Every service is bounded

- **WHEN** the baseline compose is rendered
- **THEN** each of the six services declares a `mem_limit`, and the sum stays within the documented 4C8G budget

#### Scenario: Redis evicts instead of growing

- **WHEN** Redis reaches its configured `maxmemory`
- **THEN** it evicts keys under the configured policy instead of consuming host memory
