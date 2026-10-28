# Spec Delta

## MODIFIED Requirements

### Requirement: Review manifest generation

The system MUST generate a `review.xlsx` manifest for a job whose columns are 序号/会话哈希/发生时间/问题/答案/脱敏标记/敏感标记/近似已有/建议动作/审核结果, serve it at `GET /admin/import-jobs/:id/review.xlsx`, and retain it for 30 days before scheduled cleanup. 会话哈希 MUST come from the item's `session_hash` and 发生时间 MUST be the original conversation time (`occurred_at`) rendered in ISO-8601 UTC; when an item has no captured metadata the cell MUST show `—` rather than substituting the job id or import time.

#### Scenario: Manifest downloadable

- **WHEN** an operator requests `review.xlsx` for a parsed job within 30 days
- **THEN** the system returns a redacted xlsx with one row per paired item

#### Scenario: Manifest expired

- **WHEN** an operator requests `review.xlsx` after the 30-day retention
- **THEN** the system returns HTTP 410 or 404 indicating the manifest is gone

#### Scenario: Manifest carries each item's own session and time

- **WHEN** a job contains items from two conversations at different times
- **THEN** each row shows that item's own session hash and original conversation time, and rows from different sessions do not share a hash

#### Scenario: Missing metadata rendered as placeholder

- **WHEN** an item parsed from a directly-paired file has no session or conversation time
- **THEN** the 会话哈希 and 发生时间 cells show `—`

### Requirement: Review submission and dataset import

The system MUST accept `POST /admin/import-jobs/:id/confirm` with review results, and for each approved or modified, non-auto-blocked item MUST write it to a dedicated FastGPT dataset named `历史语料-{jobId}` in batches of 50 with exponential-backoff retry (3 attempts), storing `imported_qa_id` on success. Items marked rejected MUST have their `question`, `answer_raw`, and `answer_redacted` cleared so that only `source_hash` and review status remain. Modified items MUST be written using their revised question and answer.

#### Scenario: Approved items written to dataset

- **WHEN** an operator confirms a review with 120 approved items
- **THEN** the system writes them to `历史语料-{jobId}` in batches and records `imported_qa_id` per item

#### Scenario: Discarded item body not stored

- **WHEN** an item is marked rejected and confirmed
- **THEN** its question and answer columns become NULL and only `source_hash`, review status, and review metadata remain

#### Scenario: Modified item written with revised text

- **WHEN** an item is marked modified with a revised answer
- **THEN** the dataset receives the revised answer, not the originally parsed answer

### Requirement: Batch rollback

The system MUST provide `POST /admin/import-jobs/:id/rollback` that removes the job's items from the FastGPT dataset (delete the `历史语料-{jobId}` collection or delete by batch tag), clears `imported_qa_id`, sets `imported` to 0, marks the job status `rolled_back`, and refreshes retrieval cache, without restarting the service.

#### Scenario: Rollback removes imported items

- **WHEN** an operator calls rollback on an imported job
- **THEN** its dataset collection (or batch tag) is deleted, `imported_qa_id` is cleared, and the job status is `rolled_back`

#### Scenario: Rolled-back job cannot be re-rolled back destructively

- **WHEN** rollback is called again on a job already in `rolled_back`
- **THEN** the system returns HTTP 200 without deleting another dataset or changing item rows

## ADDED Requirements

### Requirement: Item-level source hash deduplication

Every import item MUST store a `source_hash` computed as the SHA-256 of the normalized question and answer (trimmed, internal whitespace collapsed, joined by a single newline), and the hash MUST be unique across items so that re-importing the same pair is idempotent. The number of pairs skipped by this rule MUST be counted in the job's `dedup` counter, and an item rejected during review MUST retain its `source_hash` after its body is cleared.

#### Scenario: Duplicate pair within one batch skipped

- **WHEN** a parsed batch contains the same normalized question/answer pair twice
- **THEN** only one item is stored and `dedup` is 1

#### Scenario: Duplicate pair across batches skipped

- **WHEN** a later job parses a pair already stored by an earlier job
- **THEN** the pair is not stored again and the later job's `dedup` counts the skip

#### Scenario: Rejected item keeps its dedup key

- **WHEN** a rejected item's body is cleared after confirmation
- **THEN** its `source_hash` remains and still prevents the same pair from being re-imported

### Requirement: Item session metadata

Every import item produced from a conversation MUST store a `session_hash` derived irreversibly from the conversation identifier and the original conversation time as `occurred_at`. Items produced from directly-paired files MUST store NULL for both fields.

#### Scenario: Metadata captured per item

- **WHEN** an item is produced from a conversation message
- **THEN** it stores the session hash and the original conversation time, not the import time

#### Scenario: Directly-paired file has no conversation metadata

- **WHEN** an item is parsed from a `.csv` with a `question,answer` header
- **THEN** its `session_hash` and `occurred_at` are NULL
