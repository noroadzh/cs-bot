# media-recognition Specification

## Purpose
提供图片/视频/音频的智能识别能力，使机器人能够理解用户上传的多媒体内容并将其转化为文字描述，作为问答上下文的补充。

## Requirements

### Requirement: Image recognition integration

The system MUST acknowledge the WeCom callback before starting image download and recognition, then process the image asynchronously and send the result through the active-send channel. The recognition call MUST use a 10-second timeout, MUST pass the image's actual MIME type, and MUST use a prompt that extracts consultation-relevant text and condenses it into one Chinese question, returning only `[NO_TEXT]` when the image has no useful content. Recognition failure, timeout, or `[NO_TEXT]` MUST send the guidance text instead of entering the QA pipeline.

#### Scenario: Callback acknowledged before recognition

- **WHEN** an image message arrives and recognition takes several seconds
- **THEN** the callback returns 200 before the download/recognition begins, and WeCom does not retry due to a missing acknowledgement

#### Scenario: Image message triggers recognition

- **WHEN** the user sends an image message with `media_id` equal to `abc123`
- **THEN** the system downloads it asynchronously, calls qwen-vl with its actual MIME type, and injects the extracted question into the normal QA flow

#### Scenario: No useful text in image

- **WHEN** the model returns `[NO_TEXT]`
- **THEN** the system sends the image guidance text and does not call the QA engine

#### Scenario: Recognition API timeout

- **WHEN** the qwen-vl endpoint takes longer than 10 seconds
- **THEN** the system logs a warning, sends the guidance text, and does not enter the QA pipeline

#### Scenario: Recognition API failure

- **WHEN** the qwen-vl endpoint returns a non-2xx status code
- **THEN** the system logs the error code and sends the guidance text

#### Scenario: Invalid media_id

- **WHEN** the user sends an image with a non-existent `media_id`
- **THEN** the system logs the error, sends the guidance text, and does not enter the QA pipeline

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

The system MUST only invoke recognition for image types (`image/jpeg`, `image/png`, `image/gif`, `image/webp`). Voice, video, and file messages addressed to the bot MUST receive the fixed guidance text and MUST be recorded as misses with their media type; they MUST NOT be forwarded to the QA engine as text-only queries. Media messages that do not address the bot remain silent.

#### Scenario: PDF attachment is ignored

- **WHEN** the user addresses the bot with a file attachment
- **THEN** the system does not call the recognition API; it replies with the guidance text and records a miss with `media_type=file`

#### Scenario: Voice message is ignored

- **WHEN** the user addresses the bot with a voice message
- **THEN** the system does not call the recognition API; it replies with the guidance text and records a miss with `media_type=voice`

#### Scenario: Video receives guidance

- **WHEN** the user addresses the bot with a video message
- **THEN** the system replies with the guidance text and records a miss with `media_type=video`

#### Scenario: Unaddressed media stays silent

- **WHEN** the user sends an image, voice, video, or file without addressing the bot
- **THEN** the system neither replies nor records a miss

### Requirement: Recognition API configuration

The system MUST read `QWEN_VL_BASE_URL`, `QWEN_VL_API_KEY`, and `QWEN_VL_MODEL` from configuration, use `QWEN_VL_MODEL` as the requested model, apply a 10-second recognition timeout, and default to a mock implementation in `USE_MOCK_LLM=true` mode.

#### Scenario: Mock mode uses local mock

- **WHEN** `USE_MOCK_LLM=true` is set
- **THEN** the system uses a built-in mock that returns a predefined description for testing purposes

#### Scenario: Production mode uses configured endpoint

- **WHEN** `USE_MOCK_LLM` is not set or is `false`
- **THEN** the system sends the request to `QWEN_VL_BASE_URL` with the configured key and `QWEN_VL_MODEL`

### Requirement: Media recognition in question routing

The system MUST integrate recognition result BEFORE the question enters the routing/qa pipeline, so the enriched question is what gets matched against keywords and sent to the qa engine.

#### Scenario: Enriched question is used for keyword matching
- **WHEN** an image triggers recognition and the description contains "价格"
- **THEN** the keyword "价格" is matched against the enriched question, and the trigger logic proceeds as if the user typed the recognized text

### Requirement: Voice and video transcription

When the bot is @-mentioned with a voice or video message, the system MUST download the media and obtain a transcript via a configured ASR endpoint (OpenAI-compatible). For video, the system MUST extract an audio track (or equivalent) before ASR when a track is present. When audio extraction is empty or ASR fails within timeout, the system MUST extract one or more keyframes (configurable count/interval) and MAY send them to the configured VL model to produce text used as the enriched question. The system MUST enforce configured size and timeout limits. On failure of both ASR/extract and keyframe/VL paths, size/timeout exceedance, or empty usable text, it MUST send the guidance reply and record a miss with the correct `media_type` (`voice` or `video`). Successful transcripts or VL-derived text MUST enter the existing routing/QA pipeline as text. Outbound dynamic text MUST still pass the sensitive filter (R-3).

#### Scenario: Voice @-mention becomes a question

- **WHEN** a user @-mentions the bot with a voice clip and ASR succeeds
- **THEN** the transcript is answered by the QA orchestrator as text

#### Scenario: Video over size limit records miss

- **WHEN** a user @-mentions the bot with a video exceeding the configured max bytes
- **THEN** the system sends guidance, does not call QA, and records a miss with `media_type=video`

#### Scenario: Video ASR failure records miss

- **WHEN** video audio extraction or ASR fails and keyframe/VL also fails or is disabled
- **THEN** the system sends guidance and records a miss with `media_type=video`

#### Scenario: Video keyframe VL fallback

- **WHEN** video audio extract or ASR fails but keyframe extract and VL succeed
- **THEN** VL-derived text is used as the enriched question for routing/QA


### Requirement: Image chat mode

When `IMAGE_CHAT_MODE=describe` (or equivalent config), @-mentioned images MUST be answered as a user-visible visual description without requiring a separate text question and MUST NOT be forced through the FastGPT QA path solely by rewriting the question. When mode is `question` (default), recognized text MUST continue to enrich the question for keywords and QA. Describe answers that are dynamic MUST pass the outbound filter unless they are fixed guidance.

#### Scenario: Describe mode returns a caption answer

- **WHEN** image chat mode is describe and the user @-mentions an image
- **THEN** the system returns a visual description answer without requiring separate text and without requiring a FastGPT QA round-trip for that answer

#### Scenario: Question mode keeps QA enrichment

- **WHEN** image chat mode is question and recognition succeeds
- **THEN** recognized text is treated as the question for keywords and FastGPT
