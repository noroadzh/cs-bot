## Purpose

在线质检：持久化规则采样结果、超阈节流告警、运营可查询，与会话存档入队解耦。

## ADDED Requirements

### Requirement: Durable quality inspection records

The system MUST persist each quality inspection sample (manual admin submit, scheduled sample, or post-import sample) with rule outcomes, configured thresholds, and time window. Samples MUST NOT store raw chat question/answer text; identifiers MUST be hashed where logged.

#### Scenario: Manual sample persisted

- **WHEN** an authenticated operator submits `POST /admin/archive/quality-check` with metrics
- **THEN** a durable inspection row is stored and the response includes `inspectionId` while preserving an `alerts` array for compatibility

#### Scenario: History queryable

- **WHEN** an operator calls `GET /admin/archive/quality-inspections` with optional time/rule filters
- **THEN** the system returns paginated inspection summaries without raw conversation content

### Requirement: Threshold alerts with cooldown

When any rule exceeds its configured threshold, the system MUST emit at most one ops webhook alert per `(ruleId, window)` cooldown via the configured ops webhook. Webhook failure MUST NOT fail the inspection request.

#### Scenario: First breach alerts once

- **WHEN** a sample exceeds a threshold and cooldown has elapsed
- **THEN** one ops webhook is sent and the breach is recorded on the inspection

#### Scenario: Cooldown suppresses duplicate webhook

- **WHEN** the same rule breaches again inside the cooldown window
- **THEN** the sample is still persisted but no duplicate webhook is sent

#### Scenario: Missing webhook is non-fatal

- **WHEN** `OPS_WEBHOOK_URL` is unset or unreachable
- **THEN** inspection persistence succeeds and delivery failure is logged at WARN
