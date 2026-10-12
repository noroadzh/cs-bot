# miss-record Specification

## Purpose
Captures every question the bot could not confidently answer so the operations team can later expand the knowledge base; persists asynchronously and exports to Excel on demand.

## Requirements

### Requirement: Asynchronous miss persistence
The system MUST persist each low-confidence question to `miss_record` table asynchronously, never blocking the response pipeline, and MUST retry from a local cache of up to 1000 entries if the database write fails.

#### Scenario: Low-confidence question arrives
- **WHEN** the orchestrator returns `score < CONFIDENCE_THRESHOLD`
- **THEN** within 500ms (async), the system writes a row containing `question, chatId, userId, score, mediaType, status=0` to `miss_record`

#### Scenario: Database unavailable
- **WHEN** the PostgreSQL connection fails on the miss-write attempt
- **THEN** the system caches the entry in memory (FIFO cap 1000) and retries with exponential backoff

### Requirement: xlsx and json export
The system MUST expose `GET /admin/miss-records?from=<date>&to=<date>&format=xlsx|json` returning either an Excel workbook (streaming via exceljs) or a JSON envelope. The `userid` field MUST be masked as `<first-2>****` in both formats.

#### Scenario: xlsx export
- **WHEN** an admin requests `format=xlsx` over a date range that returns 500 records
- **THEN** the system responds with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="miss-records_<from>_<to>.xlsx"`

#### Scenario: json export
- **WHEN** an admin requests `format=json`
- **THEN** the system returns `{total, items:[{question, chatId, score, mediaType, status, createdAt}]}` with `userId` masked

### Requirement: 90-day retention cleanup
The system MUST run a scheduled task at 03:30 (Asia/Shanghai) daily that deletes `miss_record` rows where `created_at < now() - MISS_RECORD_RETENTION_DAYS` (default 90), retrying on failure with WARN log.

#### Scenario: Cleanup runs successfully
- **WHEN** the scheduled task fires on a healthy database
- **THEN** rows older than 90 days are deleted and the deleted count is logged at INFO level
