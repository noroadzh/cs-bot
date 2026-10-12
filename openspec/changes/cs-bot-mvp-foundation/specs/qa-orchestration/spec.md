# Spec Delta: qa-orchestration

## Purpose

Coordinates the answer-generation flow: ask the QA engine for an answer, judge its confidence, decide between answering or refusing, split long answers, resolve asset references, and apply the sensitive filter before sending.

## ADDED Requirements

### Requirement: IQAEngine interface abstraction
The system MUST define an `IQAEngine` interface with a single `ask({question, history, datasetIds?}): Promise<Result<{answer, quotes, score}>>` method. Concrete implementations (`MockQaEngine`, `FastGPTQaEngine`) MUST be selected at startup based on the `USE_MOCK_LLM` environment variable.

#### Scenario: Mock engine selected
- **WHEN** `USE_MOCK_LLM=true`
- **THEN** the system uses `MockQaEngine` for all answer requests and never makes outbound HTTP calls to the FastGPT service

#### Scenario: Real engine selected
- **WHEN** `USE_MOCK_LLM=false`
- **THEN** the system uses `FastGPTQaEngine` and validates `FASTGPT_BASE_URL` + `FASTGPT_API_KEY` at startup

### Requirement: Confidence threshold rejection
The system MUST compute `score = max(quotes[].score)` (0 when `quotes` is empty) and refuse to answer with a templated message if `score < CONFIDENCE_THRESHOLD` (default 0.75). Refusal MUST be a normal business behavior, not an error.

#### Scenario: High-confidence answer
- **WHEN** the QA engine returns quotes with `score >= 0.75`
- **THEN** the system composes and sends the answer

#### Scenario: Low-confidence answer
- **WHEN** the QA engine returns quotes with `score < 0.75` OR an empty quotes array
- **THEN** the system records the question in `miss_record` and replies with the rejection template referencing human support

### Requirement: Asset reference parsing
The system MUST parse references of the form `[[素材:<id>]]` from the answer text, cap the count at 2 per reply (FR-10 ceiling), strip the references from the text before sending, and queue up to 2 asset-send calls to follow the text reply.

#### Scenario: One asset referenced
- **WHEN** the answer contains exactly one `[[素材:N]]` marker
- **THEN** the system strips the marker, sends the text, then sends the referenced asset via `AssetSender`

#### Scenario: Three assets referenced
- **WHEN** the answer contains three `[[素材:N]]` markers
- **THEN** the system sends only the first two and silently drops the third

### Requirement: Long answer segmentation
The system MUST split any outbound text exceeding 2048 bytes into multiple segments of at most 2000 bytes, cut at sentence boundaries (。！？!?\n), and send each segment with a 300ms delay between sends.

#### Scenario: 5KB answer
- **WHEN** the composed answer is 5000 bytes
- **THEN** the system sends 3 segments (each ≤2000 bytes) at sentence boundaries with 300ms gaps

### Requirement: Fallback messages on dual-channel LLM failure
The system MUST send the configured `SLOW_REPLY_TEXT` (default "系统繁忙，请稍后再试或联系人工客服") and raise a webhook alert when both LLM channels (primary + fallback) fail or time out.

#### Scenario: Both channels timeout
- **WHEN** `LLM_TIMEOUT_MS` elapses on both primary and fallback channels
- **THEN** the system sends `SLOW_REPLY_TEXT`, logs `ErrCode.LLM_ALL_FAILED`, and triggers the alert webhook
