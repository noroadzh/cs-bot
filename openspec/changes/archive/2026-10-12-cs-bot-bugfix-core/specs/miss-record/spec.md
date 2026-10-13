# miss-record Specification (Delta)

## ADDED Requirements

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