# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Local model deployment

The deployment suite MUST provide `local-models-compose.yml` (vllm + xinference), model pull and health-check scripts, and MUST document that switching embedding requires rebuilding the vector index.

#### Scenario: Local models compose starts healthy

- **WHEN** the local-model profile is deployed
- **THEN** vllm and xinference start and pass their health checks

#### Scenario: Embedding switch requires reindex

- **WHEN** embedding is switched between cloud and local
- **THEN** the runbook requires a full vector index rebuild before serving
