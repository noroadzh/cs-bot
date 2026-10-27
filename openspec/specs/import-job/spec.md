# import-job Specification

## Purpose

提供 QA 知识批量导入 job 的创建（文件上传或 URL 抓取）、解析、状态流转、列表检索与删除能力，使运营方能把历史 FAQ 文档批量转化为待审核的问答条目。

## Requirements

### Requirement: Import job creation from file upload

The system MUST provide `POST /admin/import-jobs` that accepts a multipart upload (field `file`, plus optional `name` field), computes the file's sha256 hash, persists the raw bytes under `data/imports/<jobId>`, creates an `import_job` row with status `uploaded`, and returns HTTP 201 with `{id, name, sourceFilename, status: "uploaded"}`.

#### Scenario: Successful file upload

- **WHEN** an operator posts a 2MB `faq.txt` to `POST /admin/import-jobs` with valid Basic Auth
- **THEN** the system returns HTTP 201 with `{id, name, sourceFilename: "faq.txt", status: "uploaded"}`, stores the bytes under `data/imports/<id>`, and inserts one `import_job` row

### Requirement: Upload size and extension validation

The system MUST reject uploads exceeding `IMPORT_MAX_FILE_BYTES` (default 10MB) with HTTP 413, and MUST reject files whose extension is not one of `.txt`, `.md`, `.csv`, `.json`, `.xlsx` with HTTP 415. Both rejections MUST store no row and no bytes.

#### Scenario: Upload exceeds size limit

- **WHEN** an operator posts a 12MB file while `IMPORT_MAX_FILE_BYTES` is 10MB
- **THEN** the system returns HTTP 413 with an error code identifying the size limit and stores no row and no bytes

#### Scenario: Disallowed file extension

- **WHEN** an operator posts a file named `faq.docx`
- **THEN** the system returns HTTP 415 with an error code identifying the rejected extension and stores nothing

### Requirement: Import job creation from URL

The system MUST provide `POST /admin/import-jobs/from-url` that accepts a JSON body `{url, name?}`, fetches the URL server-side with a 30-second timeout, and then processes the fetched content identically to a file upload (hash, storage, row creation). A fetch failure (non-2xx, timeout, or network error) MUST return HTTP 502 with an error body identifying the failure and store no row.

#### Scenario: Successful URL fetch

- **WHEN** an operator posts `{url: "https://example.com/faq.txt"}` and the server fetches 500KB successfully
- **THEN** the system returns HTTP 201 with `{id, sourceFilename: "faq.txt", status: "uploaded"}` and the fetched bytes are stored as if uploaded

#### Scenario: URL fetch times out

- **WHEN** the target URL does not respond within 30 seconds
- **THEN** the system returns HTTP 502 with a timeout error code and stores no row

#### Scenario: URL returns non-2xx

- **WHEN** the target URL responds with HTTP 404
- **THEN** the system returns HTTP 502 naming the upstream status and stores no row

### Requirement: Same-source upload short-circuit

The system MUST reject a new import job whose content sha256 equals an existing job's `source_hash` that has status `parsed`, `approved`, `partial`, or `rejected`, returning HTTP 409 with the existing job's `id`. Jobs in `failed` or terminal-deleted states MUST NOT block re-upload.

#### Scenario: Duplicate content rejected

- **WHEN** an operator uploads a file whose sha256 matches an existing job in `parsed` status
- **THEN** the system returns HTTP 409 with `{existingJobId}` and does not create a new job

#### Scenario: Re-upload after failed job allowed

- **WHEN** an operator uploads a file whose sha256 matches only a `failed` job
- **THEN** the system creates a new job normally

### Requirement: Import job parsing into question-answer items

The system MUST parse an `uploaded` job's stored bytes into question/answer items asynchronously. For directly-paired formats (`.txt` Q:/A:, `.csv`/`.xlsx` with `question,answer` header, `.json` array) it stores each pair as `pending`. For conversation shapes (wecom archive / three-column table) it MUST clean, then split and pair, before storing items. Status goes `parsing` → `parsed`, or `failed` on unrecoverable errors.

#### Scenario: TXT Q/A block parsing

- **WHEN** an uploaded `.txt` contains three `Q:`/`A:` blocks separated by blank lines
- **THEN** the job becomes `parsed` with `item_count: 3` and three `import_item` rows in `pending` status

#### Scenario: CSV with header parsing

- **WHEN** an uploaded `.csv` starts with `question,answer` and holds 20 data rows
- **THEN** the job becomes `parsed` with `item_count: 20` and empty-answer rows are still created as `pending` items for human review

#### Scenario: XLSX worksheet parsing

- **WHEN** an uploaded `.xlsx` has a first worksheet whose header row is `question,answer` and holds 12 data rows
- **THEN** the job becomes `parsed` with `item_count: 12` and twelve `import_item` rows in `pending` status

#### Scenario: Job with zero parsed items

- **WHEN** an uploaded `.csv` holds only its header row
- **THEN** the job becomes `parsed` with `item_count: 0` and no item rows

#### Scenario: Unrecoverable parse failure

- **WHEN** an uploaded `.json` file does not contain an array of objects
- **THEN** the job becomes `failed`, stores a parse error message, and creates no items

#### Scenario: Conversation shape cleaned and paired

- **WHEN** an uploaded file is sniffed as a conversation shape (wecom archive or three-column table)
- **THEN** the job transitions through cleaning and pairing before `parsed`, and only paired items are stored

#### Scenario: Unpaired messages are not stored as items

- **WHEN** cleaning and pairing yields unpaired messages
- **THEN** those messages are recorded in the unpaired pool and create no import items

### Requirement: Import job listing and detail

The system MUST provide `GET /admin/import-jobs` returning `{total, limit, offset, rows}` ordered by `created_at` descending with `limit` (default 50, max 200), `offset`, and optional `status` filter; and `GET /admin/import-jobs/:id` returning the job row plus per-`review_status` item counts.

#### Scenario: Default listing

- **WHEN** an operator calls `GET /admin/import-jobs` with no parameters on a database holding 3 jobs
- **THEN** the system returns HTTP 200 with `total: 3`, `limit: 50`, `offset: 0`, rows newest-first

#### Scenario: Status filter

- **WHEN** an operator calls `GET /admin/import-jobs?status=parsed` when 2 of 5 jobs are `parsed`
- **THEN** the response contains exactly those 2 jobs and `total: 2`

#### Scenario: Unknown job id

- **WHEN** an operator calls `GET /admin/import-jobs/nonexistent`
- **THEN** the system returns HTTP 404

### Requirement: Import item listing with review filter

The system MUST provide `GET /admin/import-jobs/:id/items` returning `{total, limit, offset, rows}` of that job's items ordered by creation order, with `limit` (default 50, max 200), `offset`, and optional `review_status` and `sensitive` (boolean) filters. Each item row MUST include `question`, `answer_raw`, `answer_redacted`, and `sensitive_flags`.

#### Scenario: All items for a job

- **WHEN** an operator calls `GET /admin/import-jobs/<id>/items` on a job with 30 items
- **THEN** the first page returns 50-or-fewer rows and `total: 30`

#### Scenario: Sensitive-only filter

- **WHEN** an operator calls `GET /admin/import-jobs/<id>/items?sensitive=true` when 4 items carry non-empty `sensitive_flags`
- **THEN** the response contains exactly those 4 items

### Requirement: Import job deletion

The system MUST provide `DELETE /admin/import-jobs/:id` that removes the job row, all its `import_item` rows, and the stored bytes under `data/imports/`. Deleting a non-existent id MUST return HTTP 404. Deletion MUST be allowed regardless of job status.

#### Scenario: Deleting a parsed job

- **WHEN** an operator sends `DELETE /admin/import-jobs/<id>` for a `parsed` job holding 25 items
- **THEN** the system returns HTTP 200, and the job row, its 25 item rows, and its stored bytes no longer exist

#### Scenario: Deleting an unknown id

- **WHEN** an operator sends `DELETE /admin/import-jobs/nope`
- **THEN** the system returns HTTP 404 and nothing is removed

### Requirement: Import storage path isolation

The system MUST resolve every uploaded import file under the `data/imports/` directory and MUST reject any upload or URL-derived filename whose resolved path would escape that directory.

#### Scenario: Path traversal filename is rejected

- **WHEN** an operator uploads a file named `../../etc/passwd`
- **THEN** the system returns HTTP 400 without writing any file outside `data/imports/`

#### Scenario: Normal filename stored under generated id

- **WHEN** an operator uploads a file named `历史FAQ v3.txt`
- **THEN** the system stores it under `data/imports/<generated-job-id>` and preserves the original name only as the `source_filename` column

### Requirement: Import job stage counters

The system MUST expose per-job stage counters (`parsed`, `cleaned`, `paired`, `unpaired`, `pendingReview`, `approved`, `imported`, `failed`) on the job detail so operators can track pipeline progress.

#### Scenario: Detail shows stage counters

- **WHEN** an operator calls `GET /admin/import-jobs/:id` for a conversation-shaped job
- **THEN** the response includes the stage counters reflecting current progress
