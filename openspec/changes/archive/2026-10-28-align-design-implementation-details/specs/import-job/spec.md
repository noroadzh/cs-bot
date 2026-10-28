# Spec Delta

## MODIFIED Requirements

### Requirement: Import job stage counters

The system MUST expose per-job stage counters (`totalMessages`, `parsedMessages`, `cleaned`, `paired`, `unpaired`, `masked`, `blocked`, `dedup`, `pendingReview`, `approved`, `imported`, `failed`) on the job detail so operators can track pipeline progress. Counters MUST be persisted as each stage completes, MUST be zero before their stage runs, and MUST reflect the job's final values after any terminal outcome or rollback.

#### Scenario: Detail shows stage counters

- **WHEN** an operator calls `GET /admin/import-jobs/:id` for a conversation-shaped job
- **THEN** the response includes every stage counter reflecting current progress

#### Scenario: Counters persist across a failed import

- **WHEN** a job writes 40 of 50 approved items and then fails
- **THEN** `approved` is 50, `imported` is 40, `failed` is 10, and the counters remain visible on subsequent detail queries

#### Scenario: Counters reset by batch rollback

- **WHEN** an imported job is rolled back
- **THEN** `imported` becomes 0 while `approved` and the earlier stage counters are preserved

## ADDED Requirements

### Requirement: Single active import pipeline

The system MUST allow at most one import job to occupy the parsing, pairing, or importing stages at any time across the deployment. A request that would start a second concurrent pipeline MUST return HTTP 409 with error code `IMPORT_BUSY` naming the active job id. The admission lock MUST be released when the active job reaches a terminal state or fails, and MUST be recoverable after a process restart without manual database cleanup.

#### Scenario: Concurrent parse rejected

- **WHEN** job A is parsing and an operator calls `POST /admin/import-jobs/<B>/parse`
- **THEN** the system returns HTTP 409 `{errCode: "IMPORT_BUSY", activeJobId: "<A>"}` and job B is unchanged

#### Scenario: Lock released after failure

- **WHEN** the active job fails and reaches `failed`
- **THEN** a subsequent parse request for another job is admitted

#### Scenario: Stale lock recovered after restart

- **WHEN** the adapter restarts while a job was parsing
- **THEN** the next parse request succeeds without requiring an operator to clear a lock row

#### Scenario: Importing stage is mutually exclusive

- **WHEN** a job is writing approved items to the FastGPT dataset and another job calls confirm
- **THEN** the second confirm returns HTTP 409 `IMPORT_BUSY`
