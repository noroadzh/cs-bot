## ADDED Requirements

### Requirement: Voice and video transcription

When the bot is @-mentioned with a voice or video message, the system MUST download the media, transcribe audio via a configured ASR endpoint (OpenAI-compatible), and route the transcript through the existing QA pipeline. On ASR failure it MUST send the guidance reply and record a miss with the correct `media_type`.

#### Scenario: Voice @-mention becomes a question

- **WHEN** a user @-mentions the bot with a voice clip and ASR succeeds
- **THEN** the transcript is answered by the QA orchestrator as text

### Requirement: Image chat mode

When `IMAGE_CHAT_MODE=describe` (or equivalent config), @-mentioned images MAY be answered as visual description/chat without requiring a text question. Default mode remains "convert to question" for knowledge QA.

#### Scenario: Describe mode returns a caption answer

- **WHEN** image chat mode is describe and the user @-mentions an image
- **THEN** the system returns a visual description answer without requiring separate text
