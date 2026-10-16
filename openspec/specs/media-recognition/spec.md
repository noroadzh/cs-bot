# media-recognition Specification

## Purpose
提供图片/视频/音频的智能识别能力，使机器人能够理解用户上传的多媒体内容并将其转化为文字描述，作为问答上下文的补充。

## Requirements

### Requirement: Image recognition integration

The system MUST provide a `MediaRecognizeService` that accepts an image URL or media_id, calls the configured qwen-vl API endpoint, and returns a structured description of the image content. The service MUST be invoked when a message contains an image attachment.

#### Scenario: Image message triggers recognition
- **WHEN** the user sends a message containing an image with `media_id` equal to `abc123`
- **THEN** the system first downloads the image via the WeCom media API, then calls the qwen-vl endpoint, and appends the recognized text to the user's question

#### Scenario: Recognition API timeout
- **WHEN** the qwen-vl endpoint takes longer than `LLM_TIMEOUT_MS` (default 15s) to respond
- **THEN** the system logs a warning, returns an empty string for the description, and continues the normal question flow without the image context

#### Scenario: Recognition API failure
- **WHEN** the qwen-vl endpoint returns a non-2xx status code
- **THEN** the system logs the error code and message, returns an empty string, and continues the normal question flow

#### Scenario: Invalid media_id
- **WHEN** the user sends an image with a non-existent `media_id`
- **THEN** the system logs the error, returns an empty string, and continues processing without the image

### Requirement: Recognized text injection

The system MUST inject the recognized text into the question context as a prefix in the format: `【图片识别】<description>` followed by the original question.

#### Scenario: Recognized text is prepended
- **WHEN** the user sends "这个产品怎么使用？" with an image that returns "图片显示：一个蓝色的圆形按钮"
- **THEN** the system forms the final question string as "【图片识别】图片显示：一个蓝色的圆形按钮。这个产品怎么使用？"

#### Scenario: Empty recognition result is skipped
- **WHEN** the image recognition returns an empty string
- **THEN** the system does not prepend anything and uses the original question as-is

#### Scenario: Very long recognition result is truncated
- **WHEN** the image recognition returns more than 500 characters
- **THEN** the system truncates to 500 characters with an ellipsis suffix "..."

### Requirement: Media type filtering

The system MUST only invoke recognition for image types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`) and MUST ignore video, audio, file, and text messages.

#### Scenario: PDF attachment is ignored
- **WHEN** the user sends a PDF file attachment
- **THEN** the system does not call the recognition API and processes the message as a normal text-only query

#### Scenario: Voice message is ignored
- **WHEN** the user sends a voice message
- **THEN** the system does not call the recognition API and processes the message as a normal text-only query

### Requirement: Recognition API configuration

The system MUST read `QWEEN_VL_BASE_URL` and `QWEEN_VL_API_KEY` from the configuration, defaulting to a mock endpoint in `USE_MOCK_LLM=true` mode for development.

#### Scenario: Mock mode uses local mock
- **WHEN** `USE_MOCK_LLM=true` is set
- **THEN** the system uses a built-in mock that returns a predefined description for testing purposes

#### Scenario: Production mode uses configured endpoint
- **WHEN** `USE_MOCK_LLM` is not set or is `false`
- **THEN** the system sends the request to `QWEEN_VL_BASE_URL` with the `Authorization: Bearer QWEEN_VL_API_KEY` header

### Requirement: Media recognition in question routing

The system MUST integrate recognition result BEFORE the question enters the routing/qa pipeline, so the enriched question is what gets matched against keywords and sent to the qa engine.

#### Scenario: Enriched question is used for keyword matching
- **WHEN** an image triggers recognition and the description contains "价格"
- **THEN** the keyword "价格" is matched against the enriched question, and the trigger logic proceeds as if the user typed the recognized text
