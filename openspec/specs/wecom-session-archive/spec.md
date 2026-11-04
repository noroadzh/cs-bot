# wecom-session-archive Specification

## Purpose

企微会话存档专用拉取/回调：凭证、cursor、验签与群消息回调隔离，产出可入 import 的规范化消息。

## Requirements

### Requirement: Isolated archive client

Session-archive HTTP/SDK IO MUST use a dedicated archive client path and MUST NOT share the group-message `WecomClient` send/callback surface. Credentials and enable flags MUST come from environment via ConfigService.

#### Scenario: Pull disabled is a no-op

- **WHEN** archive pull is disabled or SDK secrets are missing
- **THEN** scheduled pull does nothing and operator-triggered pull returns `{ errCode: 'ARCHIVE_PULL_DISABLED' }` while admin push ingest remains available

### Requirement: WeCom archive pull and callback

The system MUST support scheduled SDK pull and optional signed WeCom archive callbacks. Both MUST normalize to the same message shape as admin ingest and enqueue import jobs via the existing create path. Pull MUST be single-flight per tenant/cursor, deferrable under import backpressure (R-8), and idempotent on `msgId` / source hash.

#### Scenario: Scheduled pull enqueues import

- **WHEN** the archive pull worker runs and the SDK returns new messages
- **THEN** messages are normalized and enqueued as import jobs without synchronous full parse on the pull tick

#### Scenario: Callback verifies and enqueues

- **WHEN** a WeCom archive callback delivers a signed payload
- **THEN** the system verifies signature, maps to archive messages, and enqueues via the same path as admin ingest

#### Scenario: Duplicate msgId reuses job

- **WHEN** a batch contains message ids already ingested for the same source hash
- **THEN** the system indicates reuse and does not create a second import job for that source

#### Scenario: SDK auth failure

- **WHEN** SDK auth or decrypt fails
- **THEN** the worker does not advance the cursor and operator-triggered pull surfaces `{ errCode: 'ARCHIVE_SDK_AUTH_FAILED' }`
