# Spec Delta

## MODIFIED Requirements

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
