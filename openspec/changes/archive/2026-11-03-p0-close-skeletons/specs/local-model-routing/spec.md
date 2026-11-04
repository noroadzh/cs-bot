## MODIFIED Requirements

### Requirement: Multi-model routing

The adapter MUST support selecting among registered models by name, cost, or latency policy alongside existing `MODEL_MODE` (cloud/hybrid/local). When the model catalog is non-empty, the FastGPT QA engine hot path MUST pick a primary endpoint and, on primary error (and per cloud low-score policy when applicable), retry a secondary via `pickFallback` without changing the inbound WeCom message path. An empty catalog MUST preserve the pre-existing FastGPT / `LLM_FALLBACK_*` behavior.

#### Scenario: Policy picks fallback model

- **WHEN** the primary routed model errors and a secondary model is registered in the catalog
- **THEN** the router retries on the secondary without changing the inbound message path

#### Scenario: Empty catalog keeps default channel

- **WHEN** the model catalog is empty
- **THEN** ask still uses the default FastGPT client and existing `MODEL_MODE` fallback chain
