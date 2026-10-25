# Spec Delta: acceptance-testing

## Purpose

定义全栈 6 容器集成测试与性能压测的验收口径、脚本与报告，使 UAT 前有覆盖 wecom→routing→qa→filter 完整链路的客观证据。

## ADDED Requirements

### Requirement: Full-stack integration test

The system MUST provide an integration suite that starts the six compose services (nginx/adapter/fastgpt/pg/mongo/redis) and exercises the full path: callback → trigger → context → FastGPT → confidence → filter → reply, plus未命中 → miss_record, dedup, rate-limit, and license-restricted mode.

#### Scenario: Happy-path question answered

- **WHEN** the integration suite posts a triggered question to the callback
- **THEN** a reply is produced through the full chain and no miss_record is written

#### Scenario: Low-confidence recorded

- **WHEN** a question falls below the confidence threshold
- **THEN** the refusal reply is returned and a miss_record row exists

### Requirement: Performance acceptance

The system MUST provide a load test asserting the documented targets: P95 reply latency ≤ 8s, per-group 20 msg/min and per-user 5 msg/min rate limits, and dedup idempotency, and MUST emit a report with throughput, latency, and error rate.

#### Scenario: P95 within budget

- **WHEN** the load test runs at the target concurrency
- **THEN** the P95 reply latency is ≤ 8s and the report records throughput/latency/error rate

#### Scenario: Rate limit enforced

- **WHEN** a single group exceeds 20 messages per minute
- **THEN** excess messages are rate-limited as specified and the report shows the limiter engaged

### Requirement: Reproducible acceptance runner

The system MUST expose a reproducible acceptance command (e.g. `test:acceptance`) that orchestrates the compose stack, test data, and report artifacts.

#### Scenario: Acceptance run reproducible

- **WHEN** a maintainer runs the acceptance command on a clean machine with docker
- **THEN** the stack starts, tests run, and a report artifact is produced
