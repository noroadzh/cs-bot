# acceptance-testing Specification

## Purpose

定义在「无外网、不能连远程」环境下可落地的验收：mock 全栈集成 + ab 压测 + 可选真实 6 容器冒烟，使 UAT 前有覆盖 wecom→routing→qa→filter 的客观证据。

## Requirements

### Requirement: Mock full-stack integration test

The system MUST provide an integration suite running a real adapter with a local Postgres, Redis mock, FastGPT mock server, and WeCom signature mock, exercising callback → trigger → context → QA → confidence → filter → reply plus miss_record, dedup, rate-limit, and license-restricted mode.

#### Scenario: Happy-path question answered

- **WHEN** the suite posts a triggered question to the callback
- **THEN** a reply is produced through the full chain and no miss_record is written

#### Scenario: Low-confidence recorded

- **WHEN** a question falls below the confidence threshold
- **THEN** the refusal reply is returned and a miss_record row exists

### Requirement: Performance acceptance with ab

The system MUST provide an Apache Bench load test that asserts P95 reply latency ≤ 8s, per-group 20 msg/min and per-user 5 msg/min rate limits, and dedup idempotency, emitting a report with throughput, latency, and error rate.

#### Scenario: P95 within budget

- **WHEN** the load test runs at the target concurrency
- **THEN** P95 latency is ≤ 8s and the report records throughput/latency/error rate

#### Scenario: Rate limit enforced

- **WHEN** a single group exceeds 20 messages per minute
- **THEN** excess messages are rate-limited and the report shows the limiter engaged

### Requirement: Optional real compose smoke

The system SHOULD retain the ability to run a real six-service compose smoke for environments with network/CI access, and MUST allow it to be skipped without failing when images cannot be pulled.

#### Scenario: Real stack skipped without network

- **WHEN** the environment has no network to pull images
- **THEN** the real-stack smoke is skipped and acceptance still passes on the mock full stack

### Requirement: Reproducible acceptance runner

The system MUST expose a reproducible `test:acceptance` command that orchestrates the mock full stack, test data, load test, and report artifacts.

#### Scenario: Reproducible run

- **WHEN** a maintainer runs the acceptance command on a machine with local Postgres and ab
- **THEN** the mock full stack starts, cases and load test run, and a report artifact is produced

### Requirement: Sustained load and import throughput acceptance

The acceptance suite MUST include a sustained load run of at least 50 concurrent callbacks for 10 minutes with no lost messages and P95 ≤ 8s, and an import throughput check processing 10,000 messages within 10 minutes. Both MUST emit reports under `artifacts/`.

#### Scenario: Sustained load within budget

- **WHEN** the sustained load test runs for 10 minutes at 50 concurrency
- **THEN** P95 is ≤ 8s, no messages are lost, and a report is written

#### Scenario: Import throughput meets target

- **WHEN** a 10,000-message fixture is imported
- **THEN** parsing and pairing complete within 10 minutes and a report is written
