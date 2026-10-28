# Spec Delta

## MODIFIED Requirements

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
