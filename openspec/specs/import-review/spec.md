# import-review Specification

## Purpose

定义导入条目在进入 QA 检索语料前的敏感信息脱敏与人工审核流转规则，保证未经复核的敏感内容不会进入线上问答。

## Requirements

### Requirement: Sensitive information redaction on parse

The system MUST redact seven categories of personal or contact-sensitive data from every parsed item's answer (and question) before storing it: mobile numbers, PRC ID numbers, bank card numbers, email addresses, URLs, detailed addresses, and personal names. The original text MUST remain available as `answer_raw`; the redacted text MUST be stored as `answer_redacted`.

#### Scenario: ID number redacted

- **WHEN** a parsed answer contains `11010119900307771X`
- **THEN** `answer_redacted` contains `<ID:1>` and `answer_raw` retains the original number

#### Scenario: Detailed address redacted

- **WHEN** a parsed answer contains a full street address
- **THEN** `answer_redacted` contains an `<ADDRESS:n>` placeholder and `answer_raw` retains the original text

#### Scenario: Personal name redacted

- **WHEN** a parsed answer contains a recognized personal name
- **THEN** `answer_redacted` contains a `<NAME:n>` placeholder and `answer_raw` retains the original text

#### Scenario: Redaction applies to questions too

- **WHEN** a parsed question contains an email address
- **THEN** the stored question text contains an `<EMAIL:n>` placeholder instead of the address

### Requirement: Typed redaction placeholders

Each redaction hit MUST be replaced in the redacted text with a typed placeholder `<TYPE:n>`, where `TYPE` is one of `PHONE`, `ID`, `CARD`, `EMAIL`, `URL`, `ADDRESS`, `NAME` and `n` is a per-item per-type occurrence counter starting at 1. `sensitive_flags` MUST be stored on the item as a JSON array holding each matched type once, in first-occurrence order.

#### Scenario: Mobile number redacted

- **WHEN** a parsed answer contains `请联系 13800138000`
- **THEN** `answer_redacted` contains `请联系 <PHONE:1>`, `sensitive_flags` includes `phone`, and `answer_raw` retains the original digits

#### Scenario: Multiple categories with ordered placeholders

- **WHEN** a parsed answer contains a mobile, an email, and a URL in that order
- **THEN** placeholders appear as `<PHONE:1>`, `<EMAIL:1>`, `<URL:1>` and `sensitive_flags` is `["phone", "email", "url"]`

#### Scenario: Repeated same-type hits increment the counter

- **WHEN** a parsed answer contains two different mobile numbers
- **THEN** `answer_redacted` contains `<PHONE:1>` and `<PHONE:2>` while `sensitive_flags` lists `phone` only once

#### Scenario: Clean answer is unchanged

- **WHEN** a parsed answer contains none of the seven categories
- **THEN** `answer_redacted` equals `answer_raw` and `sensitive_flags` is an empty array

### Requirement: Sensitive item review gate

The system MUST keep every item that carries at least one non-empty `sensitive_flags` entry in `pending` review status after parsing, MUST NOT make it eligible for the QA retrieval corpus, and MUST NOT treat it as approved as a side effect of `approve-all`. Only an explicit per-item review action may change a sensitive item's status.

#### Scenario: Sensitive item not auto-approved

- **WHEN** an operator calls `POST /admin/import-jobs/<id>/approve-all` on a job holding 10 items of which 3 carry sensitive flags
- **THEN** the 7 non-sensitive items become `approved` and the 3 sensitive items remain `pending`

#### Scenario: Sensitive item becomes eligible only after explicit review

- **WHEN** an operator sets a sensitive item's `review_status` to `approved` via the review endpoint
- **THEN** the item becomes eligible for the QA retrieval corpus with its `answer_redacted` text

### Requirement: Per-item review decision

The system MUST provide `PATCH /admin/import-jobs/:id/items/:itemId` accepting a JSON body `{review_status, reviewer_note?, question?, answer?}` where `review_status` is one of `approved`, `rejected`, `needs-fix`, `modified`. When `review_status` is `modified` the body MUST also carry a revised `answer` (and MAY carry a revised `question`), which MUST be redacted with the same typed-placeholder rules before storage and MUST replace the item's stored question/answer; `source_hash` MUST be recomputed from the revised text. A `modified` request without a revised answer MUST return HTTP 400. Reviewing an item whose parent job does not exist, or an item belonging to a different job, MUST return HTTP 404. A transition out of `needs-fix` MUST require `review_status` of `approved`, `rejected`, or `modified`.

#### Scenario: Approve one item

- **WHEN** an operator sends `{review_status: "approved"}` for a `pending` item
- **THEN** the item's `review_status` becomes `approved`, its `reviewed_at` is set, and the item is eligible for the QA retrieval corpus

#### Scenario: Reject with note

- **WHEN** an operator sends `{review_status: "rejected", reviewer_note: "答案不完整"}` for an item
- **THEN** the item's `review_status` becomes `rejected` and the note is stored on the item

#### Scenario: Mark for fix

- **WHEN** an operator sends `{review_status: "needs-fix"}` for a `pending` item
- **THEN** the item's `review_status` becomes `needs-fix` and the item is not eligible for the QA retrieval corpus

#### Scenario: Modify then keep

- **WHEN** an operator sends `{review_status: "modified", answer: "正确的答复，联系电话 <PHONE:1>", reviewer_note: "修正价格表述"}` for an item
- **THEN** the item stores the revised redacted answer, its `source_hash` is recomputed, `reviewed_at` is set, and the item is eligible for import

#### Scenario: Modify without revised answer rejected

- **WHEN** an operator sends `{review_status: "modified"}` with no `answer`
- **THEN** the system returns HTTP 400 and the item is unchanged

#### Scenario: Item belongs to another job

- **WHEN** an operator sends a review request for item X under job A where item X belongs to job B
- **THEN** the system returns HTTP 404 and item X is unchanged

#### Scenario: Unknown job

- **WHEN** an operator sends a review request under a job id that does not exist
- **THEN** the system returns HTTP 404

### Requirement: Bulk approval of remaining items

The system MUST provide `POST /admin/import-jobs/:id/approve-all` that sets `review_status: "approved"` on every `pending` or `needs-fix` item of that job that has no sensitive flags, and MUST return `{approved, skippedSensitive, skippedNotPending}`. The job's own status MUST then be recomputed from its items. Calling `approve-all` on a job that is not in `parsed` status MUST return HTTP 409.

#### Scenario: Bulk approve a fully clean job

- **WHEN** an operator calls `approve-all` on a `parsed` job with 12 clean `pending` items
- **THEN** the system returns `{approved: 12, skippedSensitive: 0, skippedNotPending: 0}` and the job becomes `approved`

#### Scenario: Bulk approve skips already-decided items

- **WHEN** an operator calls `approve-all` on a job where 3 items are already `rejected` and 9 are `pending`
- **THEN** the system returns `{approved: 9, skippedSensitive: 0, skippedNotPending: 3}` and the 3 rejected items keep their status

#### Scenario: Bulk approve rejects a non-parsed job

- **WHEN** an operator calls `approve-all` on a job in `uploaded` status
- **THEN** the system returns HTTP 409 and no item is changed

### Requirement: Job status recomputation from items

The system MUST recompute a job's status from its items after every review change: all items `approved` or `modified` → `approved`; at least one importable item and at least one non-importable item → `partial`; no importable item and at least one `rejected` → `rejected`; a job with zero items stays `parsed`. `modified` items MUST count as importable. A job in `rolled_back` MUST keep that status and MUST NOT be recomputed by later review changes. The recomputed status MUST be persisted and returned by subsequent detail queries.

#### Scenario: All items approved

- **WHEN** the last `pending` item of a 5-item job becomes `approved`
- **THEN** the job status becomes `approved`

#### Scenario: Mixed decisions yield partial

- **WHEN** a job's items become 3 `approved` and 2 `rejected`
- **THEN** the job status becomes `partial`

#### Scenario: Modified counts as importable

- **WHEN** a job has 2 `modified` items and 1 `rejected` item
- **THEN** the job status becomes `partial`

#### Scenario: All rejected

- **WHEN** every item of a job is set to `rejected`
- **THEN** the job status becomes `rejected`

#### Scenario: Job with zero items stays parsed

- **WHEN** a `parsed` job holds zero items (e.g. an empty CSV header-only file)
- **THEN** the job status stays `parsed`

#### Scenario: Rolled-back job stays rolled back

- **WHEN** an item of a rolled-back job is changed from `approved` to `rejected`
- **THEN** the job status remains `rolled_back`

### Requirement: Approved items enter FastGPT dataset

In addition to being eligible for the local `approved_qa` corpus, an approved item MUST be written to the job's dedicated FastGPT dataset `历史语料-{jobId}` when the job's review is confirmed, and MUST be removed from that dataset when the job is rolled back.

#### Scenario: Approved item enters dataset on confirm

- **WHEN** a job with approved items is confirmed
- **THEN** each approved item exists in `历史语料-{jobId}` and remains queryable through the local corpus fallback

#### Scenario: Rollback removes from dataset

- **WHEN** a job is rolled back
- **THEN** its approved items are no longer retrievable from `历史语料-{jobId}`
