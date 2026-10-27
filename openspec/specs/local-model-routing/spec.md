# local-model-routing Specification

## Purpose
定义模型通道选择（cloud / hybrid / local）与本地优先、故障降级、local 模式不出站的规则，使有数据不出域要求的客户可以全本地方式运行问答。

## Requirements

### Requirement: Model mode selection

The system MUST select the LLM channel from `MODEL_MODE`: `cloud` calls only cloud APIs, `local` calls only `LOCAL_LLM_BASE_URL`, and `hybrid` prefers local with cloud fallback.

#### Scenario: Cloud mode uses cloud only

- **WHEN** `MODEL_MODE=cloud`
- **THEN** only cloud LLM endpoints are called

#### Scenario: Local mode uses local only

- **WHEN** `MODEL_MODE=local`
- **THEN** only `LOCAL_LLM_BASE_URL` is called and no cloud LLM egress occurs

### Requirement: Hybrid local-first with cloud failover

In `hybrid` mode the system MUST prefer local inference and, on local timeout or failure, fall over to the cloud endpoint, recording the failover count and reason.

#### Scenario: Local timeout falls over

- **WHEN** local inference times out in `hybrid` mode
- **THEN** the request falls over to cloud and the failover is recorded

### Requirement: Local-only no-egress on failure

In `local` mode the system MUST NOT make any cloud LLM egress on failure and MUST reply with the busy message instead.

#### Scenario: Local failure stays local

- **WHEN** local inference fails in `local` mode
- **THEN** the busy message is returned and no cloud LLM request is made

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
