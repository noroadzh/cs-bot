# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Acceptance orchestration (mock-first)

The deployment suite MUST provide mock-first acceptance orchestration (local Postgres + Redis mock + FastGPT mock + WeCom signature mock) with an ab load test, and MUST retain an optional real six-service compose smoke for network/CI environments.

#### Scenario: Mock acceptance runs

- **WHEN** acceptance is run
- **THEN** the mock full stack executes the cases and load test and emits a report

#### Scenario: Real stack optional

- **WHEN** the environment has network and explicitly enables it
- **THEN** the real six-service smoke can run; otherwise it is skipped
