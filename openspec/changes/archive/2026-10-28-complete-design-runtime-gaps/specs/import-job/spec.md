# Spec Delta

## MODIFIED Requirements

### Requirement: Import storage path isolation

The system MUST resolve every uploaded import file under the `data/imports/` directory, MUST reject any upload or URL-derived filename whose resolved path would escape that directory, and MUST create the stored source file with owner-only permissions (`0600`).

#### Scenario: Path traversal filename is rejected

- **WHEN** an operator uploads a file named `../../etc/passwd`
- **THEN** the system returns HTTP 400 without writing any file outside `data/imports/`

#### Scenario: Normal filename stored under generated id

- **WHEN** an operator uploads a file named `历史FAQ v3.txt`
- **THEN** the system stores it under `data/imports/<generated-job-id>` with mode `0600` and preserves the original name only as the `source_filename` column

## ADDED Requirements

### Requirement: Asynchronous import execution

The system MUST run parsing and pairing as a background task so the HTTP request that starts a parse returns promptly. `POST /admin/import-jobs/:id/parse` MUST return HTTP 202 with the accepted job id and status, the job MUST progress through its status values without holding the request open, and clients MUST observe progress through the job detail endpoint. A second parse request while the pipeline is busy MUST be rejected with HTTP 409.

#### Scenario: Parse returns before work completes

- **WHEN** an operator starts parsing a large uploaded file
- **THEN** the endpoint returns HTTP 202 immediately and the job detail reports `parsing`/`parsed` as work proceeds

#### Scenario: Parse failure recorded asynchronously

- **WHEN** background parsing fails
- **THEN** the job becomes `failed` with a parse error and the client observes it through polling

#### Scenario: Concurrent parse rejected

- **WHEN** a parse is already running and another parse is requested
- **THEN** the second request returns HTTP 409 `IMPORT_BUSY`
