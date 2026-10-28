# import-pipeline Specification

## Purpose
把历史会话文件（企微存档/客服表格）经内容嗅探、清洗、切分与 QA 配对、脱敏、黑名单剔除、近似去重、审核清单，最终写入 FastGPT 独立数据集的完整管线，使运营方能把原始会话合规地转化为可回滚的问答语料。

## Requirements

### Requirement: Upload content sniffing

The system MUST sniff uploaded import files to identify their source shape — 企微会话存档 JSON (a message array) or a three-column table with headers 时间/说话方/内容 — before parsing, and MUST reject files whose shape cannot be recognized with HTTP 415.

#### Scenario: Wecom archive JSON recognized

- **WHEN** an operator uploads a `.json` whose top level is a message array with sender/time fields
- **THEN** the job records source shape `wecom-archive` and proceeds with archive parsing

#### Scenario: Three-column table recognized

- **WHEN** an operator uploads a `.csv`/`.xlsx` whose header row is 时间/说话方/内容
- **THEN** the job records source shape `conversation-table` and proceeds with table parsing

#### Scenario: Unrecognized shape rejected

- **WHEN** an operator uploads a file whose shape matches neither pattern
- **THEN** the system returns HTTP 415 and creates no job

### Requirement: Import message cleaning

The system MUST apply configurable cleaning rules to every parsed message, dropping system messages (join/leave/recall), placeholder messages (image/voice/video/file/emoji), the bot's own messages, repeated messages from the same sender within 60 seconds, and messages whose effective character count is below 4.

#### Scenario: System and placeholder messages dropped

- **WHEN** a parsed conversation contains join/leave system lines and image placeholders
- **THEN** those lines are excluded from pairing and do not appear in any item

#### Scenario: Repeat within 60s collapsed

- **WHEN** the same sender posts identical text twice within 60 seconds
- **THEN** only one copy is retained for pairing

#### Scenario: Cleaning rules are configurable

- **WHEN** `config/import-rules.yml` disables the short-message rule
- **THEN** messages with fewer than 4 effective characters are retained

### Requirement: Conversation segmentation and QA pairing

The system MUST group cleaned messages by (conversation id + customer id), split windows on gaps longer than 30 minutes, pair consecutive customer messages as the question with the first substantive customer-service reply (length ≥ 6, not pure emoji/thanks) as the answer, merge multi-turn same-topic exchanges, and place unpaired messages into an unpaired pool rather than auto-importing them.

#### Scenario: Customer question paired with service answer

- **WHEN** a window contains customer messages followed by a service reply of at least 6 characters
- **THEN** one item is produced with the customer text as question and the service reply as answer

#### Scenario: Multi-turn topic merged

- **WHEN** a topic spans several customer/service exchanges within one window
- **THEN** the item uses the first customer message as question and the last service reply as answer

#### Scenario: Unpaired messages pooled

- **WHEN** a customer message has no substantive service reply in its window
- **THEN** it is recorded in the unpaired pool and creates no import item

### Requirement: Import blacklist screening

The system MUST screen each paired item against `config/import-blacklist.txt` (price/discount promises, promotions, internal policy, legal/compensation promises, competitor disparagement, profanity), mark hits `auto_blocked=true`, and MUST NOT allow auto-blocked items to be bulk-approved. This blacklist MUST be independent of the outbound sensitive-word library.

#### Scenario: Blacklisted item auto-blocked

- **WHEN** a paired item matches a blacklist entry
- **THEN** its `auto_blocked` is set true and it is excluded from bulk approval

#### Scenario: Outbound filter unaffected

- **WHEN** an import item is auto-blocked by the import blacklist
- **THEN** the outbound sensitive-word filter behaviour is unchanged

### Requirement: Near-duplicate detection

The system MUST query FastGPT retrieval with each item's question, and when the top hit scores ≥ 0.9 MUST record `similar_qa_id` and default the item's suggested action to discard.

#### Scenario: Similar existing QA flagged

- **WHEN** an item's question retrieves an existing QA with score ≥ 0.9
- **THEN** the item stores `similar_qa_id` and defaults to discard suggestion

#### Scenario: No similar QA

- **WHEN** the top retrieval score is below 0.9 (or no hit)
- **THEN** the item has no `similar_qa_id` and defaults to keep suggestion

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

### Requirement: Failed item retry

The system MUST provide `POST /admin/import-jobs/:id/retry` that retries only failed dataset writes, and the retry MUST be idempotent — already-imported items are skipped by `source_hash`.

#### Scenario: Retry failed only

- **WHEN** an operator calls retry after 3 of 120 items failed to import
- **THEN** only those 3 are retried and the already-imported 117 are skipped

### Requirement: Import cleanup policy

The system MUST delete `data/import/{jobId}/source.*` immediately after a job ends (success or failure) and MUST retain only the `review.xlsx` output for the configured retention window.

#### Scenario: Source removed after job ends

- **WHEN** an import job reaches a terminal state
- **THEN** its uploaded source file is deleted from disk

### Requirement: Import capacity limits

The import API MUST reject uploads larger than 200 MB or batches exceeding 50,000 messages with a clear error, and MUST stream-parse without loading the whole file into memory.

#### Scenario: Oversized upload rejected

- **WHEN** a file larger than 200 MB is uploaded
- **THEN** the API returns a size-limit error and creates no job

### Requirement: Import retention and memory guard

The system MUST clean review manifests older than 30 days and import item metadata older than 180 days, and MUST pause import processing when process memory exceeds 80% of its limit, resuming after memory recovers.

#### Scenario: Expired manifests removed

- **WHEN** the daily cleanup runs
- **THEN** review files older than 30 days and item metadata older than 180 days are deleted

#### Scenario: Memory pressure pauses import

- **WHEN** RSS exceeds 80% during a job
- **THEN** the job pauses and resumes later without losing progress

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
