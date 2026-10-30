# Spec Delta

## ADDED Requirements

### Requirement: Adapter overhead and image budget are measurable without a live model

The default test run MUST measure adapter overhead from orchestration start to send, after subtracting an injected model delay, and MUST keep that overhead within 2 seconds. An image-path test MUST keep overhead after an injected recognition delay within 12 seconds. Neither test MUST call a live model API.

#### Scenario: Text pipeline overhead

- **WHEN** the pipeline budget test runs with a mocked engine delay
- **THEN** wall time minus the injected delay is below 2000 milliseconds

#### Scenario: Image path overhead

- **WHEN** the image budget test runs with a mocked recognition delay
- **THEN** wall time minus the injected delay is below 12000 milliseconds

### Requirement: Cross-tenant sample is at least 20 rows

The isolation test MUST insert at least 20 distinct rows into each tenant database and observe zero cross-database hits.

#### Scenario: Twenty-row sample

- **WHEN** the isolation test runs with TEST_PG_URL
- **THEN** each database contains at least 20 own rows and zero rows belonging to the other tenant
