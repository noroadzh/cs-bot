## ADDED Requirements

### Requirement: Multi-model routing

The adapter or FastGPT channel configuration MUST support selecting among registered models by name, cost, or latency policy alongside existing `MODEL_MODE` (cloud/hybrid/local).

#### Scenario: Policy picks fallback model

- **WHEN** the primary model errors and a secondary model is registered
- **THEN** the router retries on the secondary without changing the inbound message path

### Requirement: GPU cluster and fine-tune registry

The platform MUST expose APIs to register vLLM/GPU cluster endpoints and LoRA fine-tune job outputs into a model catalog consumable by the router. Training jobs MUST NOT run on the message hot path.

#### Scenario: Fine-tune artifact registered

- **WHEN** a completed LoRA job posts its artifact URI
- **THEN** the model catalog lists it and routing MAY target that model id
