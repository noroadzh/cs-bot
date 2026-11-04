# local-model-routing Specification

## Purpose
定义模型通道选择（cloud / hybrid / local）与本地优先、故障降级、local 模式不出站的规则，使有数据不出域要求的客户可以全本地方式运行问答。

## Requirements

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

### Requirement: Multi-model routing

The adapter MUST support selecting among registered models by name, cost, or latency policy alongside existing `MODEL_MODE` (cloud/hybrid/local). When the model catalog is non-empty, the FastGPT QA engine hot path MUST pick a primary endpoint and, on primary error (and per cloud low-score policy when applicable), retry a secondary via `pickFallback` without changing the inbound WeCom message path. An empty catalog MUST preserve the pre-existing FastGPT / `LLM_FALLBACK_*` behavior.

#### Scenario: Policy picks fallback model

- **WHEN** the primary routed model errors and a secondary model is registered in the catalog
- **THEN** the router retries on the secondary without changing the inbound message path

#### Scenario: Empty catalog keeps default channel

- **WHEN** the model catalog is empty
- **THEN** ask still uses the default FastGPT client and existing `MODEL_MODE` fallback chain


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
