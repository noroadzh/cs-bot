## MODIFIED Requirements

### Requirement: GPU cluster and fine-tune registry

The platform MUST expose APIs to register vLLM/GPU cluster endpoints and LoRA fine-tune job outputs into a model catalog consumable by the router. Registered GPU/vLLM endpoints MUST be health-probed on a schedule; unhealthy endpoints MUST NOT be selected by the router until they recover. The platform MUST support fine-tune job records (create/list/status) and a completion callback that registers the artifact into the catalog. Training job execution and GPU provisioning MUST NOT run on the WeCom message hot path.

#### Scenario: Fine-tune artifact registered

- **WHEN** a completed LoRA job posts its artifact URI
- **THEN** the model catalog lists it and routing MAY target that model id

#### Scenario: Unhealthy endpoint skipped

- **WHEN** a registered vLLM endpoint fails health probes beyond the failure threshold
- **THEN** model routing does not pick that endpoint until probes succeed again

#### Scenario: Fine-tune job tracked off hot path

- **WHEN** an operator creates a fine-tune job via the platform API
- **THEN** the job is recorded with a non-hot-path status lifecycle and message handling does not block on training
