# Spec Delta: import-review

## ADDED Requirements

### Requirement: Approved items enter FastGPT dataset

In addition to being eligible for the local `approved_qa` corpus, an approved item MUST be written to the job's dedicated FastGPT dataset `历史语料-{jobId}` when the job's review is confirmed, and MUST be removed from that dataset when the job is rolled back.

#### Scenario: Approved item enters dataset on confirm

- **WHEN** a job with approved items is confirmed
- **THEN** each approved item exists in `历史语料-{jobId}` and remains queryable through the local corpus fallback

#### Scenario: Rollback removes from dataset

- **WHEN** a job is rolled back
- **THEN** its approved items are no longer retrievable from `历史语料-{jobId}`
