# Spec Delta: observability-logging

## Purpose

为「无法 SSH、只能打包发布」的部署提供可定位问题的结构化日志：统一 JSON 格式、HTTP 访问日志、请求级 trace、全局异常捕获、关键链路埋点、脱敏、级别与慢日志。

## ADDED Requirements

### Requirement: Structured JSON log format

The system MUST emit one-line JSON logs carrying `level`, `time`, `app`, `version`, `env`, `module`, and, within a request, the request's `traceId`.

#### Scenario: Log line is JSON with base fields

- **WHEN** any module writes a log
- **THEN** the line is a single JSON object including level/time/app/version/env/module

### Requirement: HTTP access logging

The system MUST log every HTTP request with `traceId`, method, path, status, `costMs`, remote IP, and user agent, while redacting sensitive query parameters.

#### Scenario: Callback request logged

- **WHEN** a `POST /wecom/callback` arrives
- **THEN** one access log records traceId, status, and costMs

#### Scenario: Health checks do not flood logs

- **WHEN** `/healthz` is polled frequently
- **THEN** its access logs are sampled or recorded at a lower level and do not flood the log

### Requirement: Request-scoped trace identifier

The system MUST generate or propagate a `traceId` per request and attach the same `traceId` to every log emitted while handling it; an existing wecom `traceId` MUST be reused.

#### Scenario: Trace propagates across layers

- **WHEN** a callback flows through controller → routing → qa → sender
- **THEN** every layer's logs carry the same traceId

### Requirement: Global exception capture

The system MUST capture unhandled exceptions and HttpExceptions, log `errCode`/message/stack/context, and return a uniform error body that does not expose stack traces.

#### Scenario: Unhandled error logged and sanitized

- **WHEN** a controller throws an unexpected error
- **THEN** an error log includes the stack and the response body omits it

#### Scenario: HttpException keeps status

- **WHEN** a business path throws HttpException (e.g. 409)
- **THEN** a log records its errCode and the response status code is unchanged

### Requirement: Question-answer pipeline instrumentation

The system MUST log key QA stages: context read, engine call (engine/source/costMs/score/tokens), confidence decision, filter hit, and send result (segment count/failure).

#### Scenario: Engine call traced

- **WHEN** the QA engine is invoked
- **THEN** a log records engine/source/costMs/ok/score

#### Scenario: Send failure logged

- **WHEN** message sending fails
- **THEN** an error log records the segment position and the error

### Requirement: Control-plane operation instrumentation

The system MUST log control-plane operations (tenant create/provision/quota/upgrade/monitor/sweep/offboard) with an input summary and the result/duration.

#### Scenario: Provision logged

- **WHEN** provision runs
- **THEN** a log records tenantId, step, costMs, and outcome

### Requirement: External dependency failure logging

The system MUST log errCode, endpoint, duration, and error summary when DB/Redis/FastGPT/WeCom/LLM calls fail.

#### Scenario: Redis failure logged

- **WHEN** a Redis call fails
- **THEN** an error log records detail and err, and the degrading behavior is unchanged

### Requirement: Log redaction of sensitive data

The system MUST redact message bodies, answers, secrets, tokens, phone numbers, and ID numbers in logs, recording only hash/length/truncation, and MUST NOT print `.env` or license private keys.

#### Scenario: Message body not logged

- **WHEN** logging message-related events
- **THEN** the log holds only userIdHash/length/truncation, not the full body

### Requirement: Log level and slow-operation logging

The system MUST honor `LOG_LEVEL` for verbosity and MUST record a slow log when a request or external call exceeds `SLOW_LOG_MS`.

#### Scenario: Slow call logged

- **WHEN** an external call exceeds SLOW_LOG_MS
- **THEN** a slow log records costMs and the target

### Requirement: Lifecycle logging

The system MUST log startup phases (config/license/redis/pg/listen) with the build version and MUST log graceful shutdown on SIGTERM, and MUST capture process-level uncaught exceptions and unhandled rejections.

#### Scenario: Startup phases logged

- **WHEN** the application starts
- **THEN** each readiness phase and the version are logged

#### Scenario: Uncaught rejection logged

- **WHEN** an unhandled promise rejection occurs
- **THEN** a fatal log records it and the process does not exit silently
