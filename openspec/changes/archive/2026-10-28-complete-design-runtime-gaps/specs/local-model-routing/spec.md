# Spec Delta

## MODIFIED Requirements

### Requirement: Model mode selection

The system MUST route all QA through FastGPT RAG and select the model channel from `MODEL_MODE`: `cloud` uses FastGPT with the cloud model channel; `local` uses FastGPT configured with a local model channel and MUST NOT allow cloud LLM fallback; `hybrid` uses FastGPT primary and falls back to the cloud model channel only when the FastGPT call fails.

#### Scenario: Cloud mode uses cloud only

- **WHEN** `MODEL_MODE=cloud`
- **THEN** QA goes through FastGPT and no local model channel is required

#### Scenario: Local mode uses local only

- **WHEN** `MODEL_MODE=local` and FastGPT fails
- **THEN** the busy message is returned and no cloud LLM request is made

#### Scenario: Hybrid falls back on FastGPT failure

- **WHEN** `MODEL_MODE=hybrid` and the FastGPT call fails
- **THEN** the request falls back to the cloud model channel and the failover is recorded

### Requirement: Hybrid local-first with cloud failover

In `hybrid` mode the system MUST prefer FastGPT and, on FastGPT timeout or failure, fall over to the cloud model channel, recording the failover count and reason. The system MUST probe FastGPT health every 30 seconds while degraded and MUST resume the FastGPT-primary path only after five consecutive minutes of healthy probes.

#### Scenario: Local timeout falls over

- **WHEN** the FastGPT call times out in `hybrid` mode
- **THEN** the request falls over to cloud and the failover is recorded

#### Scenario: Recovery hysteresis

- **WHEN** FastGPT recovers after a failure
- **THEN** it is used again only after five consecutive minutes of healthy probes

### Requirement: Local-only no-egress on failure

In `local` mode the system MUST NOT make any cloud LLM egress on failure and MUST reply with the busy message instead.

#### Scenario: Local failure stays local

- **WHEN** the FastGPT local-model call fails in `local` mode
- **THEN** the busy message is returned and no cloud LLM request is made

### Requirement: Runtime model mode wiring

The system MUST construct and inject the FastGPT QA engine at runtime for every deployment and MUST validate the FastGPT base URL/API key and `MODEL_MODE` at startup. A configuration missing FastGPT connectivity MUST fail fast before the HTTP server listens.

#### Scenario: Hybrid route is active in production wiring

- **WHEN** the adapter starts with `MODEL_MODE=hybrid` and valid FastGPT configuration
- **THEN** QA requests go through the FastGPT engine with cloud fallback enabled

#### Scenario: Local mode never egresses

- **WHEN** `MODEL_MODE=local` and FastGPT is unavailable
- **THEN** the user receives the busy message and no cloud LLM request is issued

#### Scenario: Missing local endpoint rejected at startup

- **WHEN** `FASTGPT_BASE_URL` or `FASTGPT_API_KEY` is empty
- **THEN** startup fails with a configuration error naming the missing variable
