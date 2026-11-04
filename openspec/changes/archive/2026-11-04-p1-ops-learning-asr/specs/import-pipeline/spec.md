## MODIFIED Requirements

### Requirement: Optional zero-review auto learning

The system MUST support a configuration switch (default off) that allows low-risk miss clusters or import items to be written into FastGPT without human confirm. Clustering MUST produce suggested answers for operator review. High-risk items (sensitive hits or policy-marked clusters) MUST remain in a human review queue even when the switch is on. Every auto-ingest MUST write a queryable audit entry. The tenant console MUST expose a learning review page listing suggestions, queue state, and auto-learning audit history.

#### Scenario: Auto learning off by default

- **WHEN** the auto-learning switch is unset
- **THEN** import confirm and miss ingest still require an explicit operator action

#### Scenario: Suggested answers for clusters

- **WHEN** an operator runs miss clustering for a recent window
- **THEN** each cluster includes a suggested answer draft suitable for review before ingest

#### Scenario: High-risk stays in queue

- **WHEN** auto-learning is on and a cluster is marked high-risk
- **THEN** the system does not auto-ingest that cluster and keeps it in the human review queue

#### Scenario: Auto-learning audit queryable

- **WHEN** an auto-ingest occurs
- **THEN** an audit entry is recorded and available via the learning audit API/UI
