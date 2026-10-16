# Spec Delta

## MODIFIED Requirements

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