## MODIFIED Requirements

### Requirement: Miss media type and status

Miss records MUST store the triggering media type (`voice`/`video`/`file`/`image`, empty for text) and a processing status (`0` unhandled, `1` learned, `2` ignored). Existing export paths MUST include both fields. The admin API MUST allow updating status via `PATCH /admin/miss/:id` with body `{ status: 0|1|2 }`. Unauthorized callers MUST receive 401.

#### Scenario: Operator marks miss as learned

- **WHEN** an authenticated admin calls `PATCH /admin/miss/:id` with `{ "status": 1 }`
- **THEN** the row's status becomes `1` and subsequent list/export reflects the new status
