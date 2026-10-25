# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Integration and load-test orchestration

The deployment suite MUST document and provide orchestration for the full-stack integration and load-test runs (six containers, test data, report output), separate from unit tests.

#### Scenario: Integration orchestrates six containers

- **WHEN** the integration suite runs
- **THEN** the six compose services are started and torn down around it

#### Scenario: Load test report emitted

- **WHEN** the load test completes
- **THEN** a report artifact with throughput/latency/error rate is written
