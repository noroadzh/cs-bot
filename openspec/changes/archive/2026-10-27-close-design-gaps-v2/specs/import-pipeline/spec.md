# Spec Delta: import-pipeline

## ADDED Requirements

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
