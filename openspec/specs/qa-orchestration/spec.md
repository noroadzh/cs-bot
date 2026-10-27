# qa-orchestration Specification

## Purpose
Coordinates the answer-generation flow: ask the QA engine for an answer, judge its confidence, decide between answering or refusing, split long answers, resolve asset references, and apply the sensitive filter before sending.

## Requirements

### Requirement: IQAEngine interface abstraction

The system MUST define an `IQAEngine` interface with a single `ask({question, history, datasetIds?, imageContext?: string}): Promise<Result<{answer, quotes, score}>>` method. The optional `imageContext` parameter carries the result of media recognition (from the `media-recognition` capability) and SHOULD be prepended to the question when present. Concrete implementations (`MockQaEngine`, `FastGPTQaEngine`) MUST be selected at startup based on the `USE_MOCK_LLM` environment variable.

#### Scenario: Mock engine selected
- **WHEN** `USE_MOCK_LLM=true`
- **THEN** the system uses `MockQaEngine` for all answer requests and never makes outbound HTTP calls to the FastGPT service

#### Scenario: Real engine selected
- **WHEN** `USE_MOCK_LLM=false`
- **THEN** the system uses `FastGPTQaEngine` and validates `FASTGPT_BASE_URL` + `FASTGPT_API_KEY` at startup

#### Scenario: Image context is passed to QA engine
- **WHEN** the user sends a message with an image and the recognition returns "图片显示：一个蓝色的圆形按钮"
- **THEN** the QA engine receives `question: "这个产品怎么使用？"`, `imageContext: "【图片识别】图片显示：一个蓝色的圆形按钮。"`

#### Scenario: No image context when no image
- **WHEN** the user sends a text-only message
- **THEN** the QA engine receives the question without the `imageContext` field

### Requirement: Confidence threshold rejection
The system MUST compute `score = max(quotes[].score)` (0 when `quotes` is empty) and refuse to answer with a templated message if `score < CONFIDENCE_THRESHOLD` (default 0.75). Refusal MUST be a normal business behavior, not an error.

#### Scenario: High-confidence answer
- **WHEN** the QA engine returns quotes with `score >= 0.75`
- **THEN** the system composes and sends the answer

#### Scenario: Low-confidence answer
- **WHEN** the QA engine returns quotes with `score < 0.75` OR an empty quotes array
- **THEN** the system records the question in `miss_record` and replies with the rejection template referencing human support

### Requirement: Asset reference parsing

The system MUST parse references of the form `[[素材:<id>]]` from the answer text, cap the count at 2 per reply (FR-10 ceiling), strip the references from the text before sending, and queue up to 2 asset-send calls to follow the text reply. The asset resolution MUST use the `media-management` capability to fetch the asset's type and URL before sending.

#### Scenario: One asset referenced
- **WHEN** the answer contains exactly one `[[素材:N]]` marker
- **THEN** the system strips the marker, sends the text, then sends the referenced asset via `AssetSender`

#### Scenario: Three assets referenced
- **WHEN** the answer contains three `[[素材:N]]` markers
- **THEN** the system sends only the first two and silently drops the third

#### Scenario: Asset reference resolution uses media-management
- **WHEN** the answer contains `[[素材:abc123]]`
- **THEN** the system resolves the asset via `media-management` to obtain `{type, url, name}` and sends the asset using the appropriate method

#### Scenario: Unknown asset id is skipped
- **WHEN** the answer contains `[[素材:missing]]` and no such asset exists
- **THEN** the system logs a warning, skips the asset, and continues sending the text reply

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

### Requirement: Model mode aware QA routing

The QA orchestration MUST select its LLM channel and degradation path according to `MODEL_MODE` (cloud / hybrid / local), delegating channel selection to the model-routing capability.

#### Scenario: Routing follows model mode

- **WHEN** `MODEL_MODE=hybrid`
- **THEN** QA orchestration prefers local inference and falls over to cloud on failure

### Requirement: Question normalization and input guards

Before QA, the system MUST strip bot mentions and configured trigger prefixes from the question text. Questions that are empty, punctuation-only, or longer than 500 characters MUST receive the guidance text without calling any model.

#### Scenario: Mention and prefix stripped

- **WHEN** a group member sends "客服：怎么开发票" where "客服：" is a trigger prefix
- **THEN** the QA engine receives "怎么开发票"

#### Scenario: Oversized question guarded

- **WHEN** the normalized question exceeds 500 characters
- **THEN** the user receives the guidance text and no LLM call is made

### Requirement: Answer source citations

When the knowledge base returns retrieval quotes, the reply MUST include at most two source citations in the form `—— 来源：《文档名》`.

#### Scenario: Citations appended

- **WHEN** an answer is produced with two or more retrieval quotes
- **THEN** the reply ends with at most two source citations

#### Scenario: No quotes no citation

- **WHEN** an answer is produced without retrieval quotes
- **THEN** the reply contains no citation line

### Requirement: Primary channel retry

The primary model channel MUST retry once with a short backoff before falling back to the secondary channel.

#### Scenario: Transient failure recovered

- **WHEN** the first primary call fails and the retry succeeds
- **THEN** the retry result is used and the fallback channel is not called
