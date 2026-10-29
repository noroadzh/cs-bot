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
The system MUST expose `GET /admin/miss-records?from=<date>&to=<date>&format=xlsx|json` returning either an Excel workbook (streaming via exceljs) or a JSON envelope. The `userid` field MUST be masked with the shared middle-mask helper (first two characters, `***`, last two characters) in both formats, never emitted raw.

#### Scenario: xlsx export
- **WHEN** an admin requests `format=xlsx` over a date range that returns 500 records
- **THEN** the system responds with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="miss-records_<from>_<to>.xlsx"`

#### Scenario: json export
- **WHEN** an admin requests `format=json`
- **THEN** the system returns `{total, items:[{question, chatId, score, mediaType, status, createdAt}]}` with `userId` masked

#### Scenario: json export never exposes raw identifiers

- **WHEN** an admin requests `format=json` for records whose `user_id` is `wxid_abcdefg123`
- **THEN** the response contains no raw `user_id`, `trace_id`, or `engine` value, and any `userId` present in `items` is masked


### Requirement: 90-day retention cleanup
The system MUST run a scheduled task at 03:30 (Asia/Shanghai) daily that deletes `miss_record` rows where `created_at < now() - MISS_RECORD_RETENTION_DAYS` (default 90), retrying on failure with WARN log.

#### Scenario: Cleanup runs successfully
- **WHEN** the scheduled task fires on a healthy database
- **THEN** rows older than 90 days are deleted and the deleted count is logged at INFO level

### Requirement: xlsx streaming via WorkbookWriter
The system MUST export `format=xlsx` through `ExcelJS.stream.xlsx.WorkbookWriter` writing directly to the HTTP response stream. The implementation MUST NOT buffer the entire result set in memory before sending. The response MUST set `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and `Content-Disposition: attachment; filename="miss-records_<from>_<to>.xlsx"`.

#### Scenario: 50000 records streaming
- **WHEN** an admin requests `format=xlsx` over a window returning 50000 records
- **THEN** the system writes rows one-by-one via `sheet.addRow()` and commits the workbook without holding more than a single row in memory

#### Scenario: Client disconnect mid-stream
- **WHEN** the HTTP client closes the connection before `workbook.commit()` resolves
- **THEN** the export service MUST catch the stream error, log a WARN, and not throw to the controller

### Requirement: MissCleanupService registered with @Cron
The system MUST register `MissCleanupService` as a provider in `MissModule` and attach `@Cron('30 3 * * *', { timeZone: 'Asia/Shanghai' })` to its `cleanup()` method. `cleanup()` MUST execute `DELETE FROM miss_record WHERE created_at < now() - MISS_RECORD_RETENTION_DAYS days` and log the deleted count at INFO level.

#### Scenario: Cleanup runs at 03:30 Asia/Shanghai
- **WHEN** the cron fires at 03:30 Asia/Shanghai on a healthy database with 200 rows older than 90 days
- **THEN** the service deletes the 200 rows and logs `deletedCount: 200` at INFO level

#### Scenario: ScheduleModule missing
- **WHEN** `ScheduleModule.forRoot()` is absent from `AppModule`
- **THEN** `MissCleanupService.cleanup()` MUST log a WARN at `onModuleInit` so that operators notice the missing module

### Requirement: Media type and processing status metadata

Miss records MUST store the triggering media type (`voice`/`video`/`file`, empty for text) and a processing status (`0` unhandled, `1` learned, `2` ignored). Existing export paths MUST include both fields, and existing rows MUST remain valid after the schema extension.

#### Scenario: Media miss persisted

- **WHEN** a voice message addressed to the bot is recorded
- **THEN** the stored row has `media_type=voice` and default status `0`

#### Scenario: Export includes status

- **WHEN** an operator exports miss records as JSON or xlsx
- **THEN** each row includes `mediaType` and `status`
