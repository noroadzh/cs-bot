## ADDED Requirements

### Requirement: Optional zero-review auto learning

The system MUST support a configuration switch (default off) that allows low-risk miss clusters or import items to be written into FastGPT without human confirm. Every auto-ingest MUST write an audit row. High-risk items MUST remain in the human review queue even when the switch is on.

#### Scenario: Auto learning off by default

- **WHEN** the auto-learning switch is unset
- **THEN** import confirm and miss ingest still require an explicit operator action

### Requirement: Session archive realtime ingest

The system MUST accept WeCom session-archive callbacks or pull jobs, normalize messages into the import pipeline schema, and support online quality checks (sensitive hits, refusal rate, latency) with audit and ops alerts.

#### Scenario: Archive batch enqueued

- **WHEN** a valid archive payload arrives
- **THEN** the system creates or appends an import job without requiring a manual file upload
