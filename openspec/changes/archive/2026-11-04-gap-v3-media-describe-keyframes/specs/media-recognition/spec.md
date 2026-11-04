## MODIFIED Requirements

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
