## MODIFIED Requirements

### Requirement: Session archive realtime ingest

The system MUST accept WeCom session-archive payloads from admin push ingest, scheduled/manual pull, and optional callbacks, normalize messages into the import pipeline schema (wecom-archive JSON), create a real `import_job` via the existing import create path without requiring a manual multipart upload, and support online quality checks with ops alerts per quality-inspection when that capability is enabled. Synchronous full parse on the ingest/pull request MUST NOT be required (R-8).

#### Scenario: Archive batch enqueued

- **WHEN** a valid archive payload arrives at the archive ingest API or from a successful pull/callback normalization
- **THEN** the system creates an `import_job` (or reuses by source hash) and returns that job id without requiring a manual file upload

#### Scenario: Archive quality sample

- **WHEN** operators submit a quality-check sample with sensitive hits, refusal rate, or high p95 latency above thresholds
- **THEN** the system records corresponding quality alerts for ops follow-up (durable when quality-inspection is applied)
