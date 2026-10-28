# platform-monitoring Specification

## Purpose
定义平台对各租户实例的运行指标聚合、平台总览与异常处理，使运营方能在一个视图内掌握所有实例健康度并对异常自动响应。

## Requirements

### Requirement: Instance metric aggregation

The system MUST aggregate each tenant instance's `/healthz` state, QA failure rate, LLM failure rate, and container resource usage.

#### Scenario: Metrics aggregated

- **WHEN** the platform polls tenant instances
- **THEN** each instance's health, error rates, and resource usage are collected

### Requirement: Platform overview endpoint

The system MUST provide `GET /platform/usage` returning tenant count, aggregate resource usage, and the list of unhealthy instances.

#### Scenario: Overview returned

- **WHEN** an operator calls `GET /platform/usage`
- **THEN** the response includes tenant count, resource summary, and unhealthy instances

### Requirement: Anomaly auto-restart and alert

The system MUST run a periodic health sweep over every non-terminated tenant, MUST automatically restart an instance after its health check fails on consecutive sweeps (default 2), and MUST emit an alert when a restart is attempted or when the instance cannot be recovered. Sweeps MUST be bounded: at most a configurable number of restarts per tenant per hour (default 3) with exponential backoff between attempts. Every restart attempt and alert MUST be recorded in the platform audit log with the tenant id and outcome. A failed restart MUST NOT abort the sweep or crash the process, and the sweep MUST be skipped safely when no restart handler is configured.

#### Scenario: Unhealthy instance restarted

- **WHEN** an instance's health check fails on the configured number of consecutive sweeps
- **THEN** the platform restarts it and records an alert and a restart audit entry naming the tenant

#### Scenario: Single failed probe does not restart

- **WHEN** an instance fails one probe and succeeds on the next
- **THEN** no restart is attempted

#### Scenario: Restart storm is capped

- **WHEN** an instance keeps failing after reaching the per-hour restart limit
- **THEN** the platform stops restarting it, records an unrecoverable alert, and continues probing other tenants

#### Scenario: Restart handler absent

- **WHEN** the monitor runs without a configured restart handler
- **THEN** it still collects metrics, emits alerts for unhealthy tenants, and performs no restart

### Requirement: TLS-aware instance probe

The platform monitor MUST probe tenant instances using the tenant's host and port and MUST support HTTPS with a configurable TLS verification policy.

#### Scenario: HTTPS tenant probed

- **WHEN** a tenant exposes only 443 via nginx with TLS
- **THEN** the probe reaches `https://<host>:<port>/healthz` and reports healthy

#### Scenario: TLS verification configurable

- **WHEN** the deployment uses self-signed certificates
- **THEN** an operator can disable certificate verification without changing code
