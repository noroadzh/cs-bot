# Spec Delta: acceptance-testing

## ADDED Requirements

### Requirement: Sustained load and import throughput acceptance

The acceptance suite MUST include a sustained load run of at least 50 concurrent callbacks for 10 minutes with no lost messages and P95 ≤ 8s, and an import throughput check processing 10,000 messages within 10 minutes. Both MUST emit reports under `artifacts/`.

#### Scenario: Sustained load within budget

- **WHEN** the sustained load test runs for 10 minutes at 50 concurrency
- **THEN** P95 is ≤ 8s, no messages are lost, and a report is written

#### Scenario: Import throughput meets target

- **WHEN** a 10,000-message fixture is imported
- **THEN** parsing and pairing complete within 10 minutes and a report is written
