# Spec Delta

## MODIFIED Requirements

### Requirement: Import retention and memory guard

The system MUST clean review manifests older than 30 days and import item metadata older than 180 days, and MUST pause import processing when its incremental working set exceeds 200 MB or process RSS exceeds 80% of the configured limit, resuming after memory recovers.

#### Scenario: Expired manifests removed

- **WHEN** the daily cleanup runs
- **THEN** review files older than 30 days and item metadata older than 180 days are deleted

#### Scenario: Memory pressure pauses import

- **WHEN** the job's incremental working set exceeds 200 MB (or RSS exceeds 80% of the configured limit) during a job
- **THEN** the job pauses and resumes later without losing progress

## ADDED Requirements

### Requirement: Unpaired message review and pairing

The system MUST expose the unpaired-message pool of a job and allow an operator to pair a customer message with a service reply. Pairing MUST create a `pending` import item, remove the paired messages from the pool, and count it in the job's paired counter; unmatched messages MUST remain reviewable and MUST NOT be auto-imported.

#### Scenario: List unpaired messages

- **WHEN** an operator requests the unpaired pool of a job with unpaired messages
- **THEN** the response lists them with conversation, sender, content, and original time

#### Scenario: Manual pairing creates a pending item

- **WHEN** an operator pairs a customer message with a service reply
- **THEN** a `pending` item is created with those texts and the messages leave the unpaired pool

#### Scenario: Unpaired messages stay out of the corpus

- **WHEN** a job is confirmed without pairing its unpaired messages
- **THEN** those messages are not written to the FastGPT dataset

### Requirement: Rollback dataset identifier persistence

The system MUST persist the FastGPT dataset identifier (or a stable collection name usable for deletion) on the import job when the dataset is created, and rollback MUST be able to delete the dataset after a service restart without relying on in-memory state.

#### Scenario: Rollback after restart

- **WHEN** the adapter restarts after a job imported items, then rollback is called
- **THEN** the dataset is found from persisted state and deleted, and `imported_qa_id` is cleared

#### Scenario: Rollback remains idempotent

- **WHEN** rollback is called twice
- **THEN** the second call returns success without deleting another dataset or changing item rows
