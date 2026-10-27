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

The system MUST automatically restart an unhealthy instance and emit an alert when its health check keeps failing.

#### Scenario: Unhealthy instance restarted

- **WHEN** an instance's health check keeps failing
- **THEN** the platform restarts it and raises an alert

### Requirement: TLS-aware instance probe

The platform monitor MUST probe tenant instances using the tenant's host and port and MUST support HTTPS with a configurable TLS verification policy.

#### Scenario: HTTPS tenant probed

- **WHEN** a tenant exposes only 443 via nginx with TLS
- **THEN** the probe reaches `https://<host>:<port>/healthz` and reports healthy

#### Scenario: TLS verification configurable

- **WHEN** the deployment uses self-signed certificates
- **THEN** an operator can disable certificate verification without changing code
