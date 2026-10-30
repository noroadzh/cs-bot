# Spec Delta

## MODIFIED Requirements

### Requirement: Instance metric aggregation

The system MUST aggregate each tenant instance's `/healthz` state, QA failure rate, LLM failure rate, and container resource usage.

#### Scenario: Metrics aggregated

- **WHEN** the platform polls tenant instances
- **THEN** each instance's health, error rates, and resource usage are collected

#### Scenario: Resource usage reported

- **WHEN** an instance responds to `/healthz`
- **THEN** the payload includes `resources.cpuPct` and `resources.memPct`, and the platform surfaces both in `GET /platform/usage`

## ADDED Requirements

### Requirement: Resource water level alert

The platform MUST raise one operational alert when a tenant instance stays above the configured CPU or memory threshold for the configured number of consecutive probes. The alert MUST be window-throttled per tenant and MUST NOT restart the instance.

#### Scenario: Sustained high usage alerts

- **WHEN** an instance reports CPU or memory at or above the threshold on N consecutive probes
- **THEN** one `tenant.alert` entry with reason `resource_high` is recorded

#### Scenario: Single spike does not alert

- **WHEN** usage exceeds the threshold on fewer than N consecutive probes
- **THEN** no alert is recorded

#### Scenario: High usage does not restart

- **WHEN** the resource alert fires for a healthy instance
- **THEN** the instance is not restarted
