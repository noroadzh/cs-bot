# Spec Delta: local-model-routing

## ADDED Requirements

### Requirement: Runtime model mode wiring

The system MUST construct and inject the model router at runtime for every deployment, and MUST validate model-mode configuration at startup. `MODEL_MODE=local|hybrid` without a local LLM endpoint MUST fail fast before the HTTP server listens.

#### Scenario: Hybrid route is active in production wiring

- **WHEN** the adapter starts with `MODEL_MODE=hybrid` and a local endpoint configured
- **THEN** QA requests go through the local-first router rather than the cloud-only engine path

#### Scenario: Local mode never egresses

- **WHEN** `MODEL_MODE=local` and the local endpoint is unavailable
- **THEN** the user receives the busy message and no cloud LLM request is issued

#### Scenario: Missing local endpoint rejected at startup

- **WHEN** `MODEL_MODE=local` or `hybrid` and `LOCAL_LLM_BASE_URL` is empty
- **THEN** startup fails with a configuration error naming the missing variable
