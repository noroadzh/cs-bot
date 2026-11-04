## MODIFIED Requirements

### Requirement: Voice and video transcription

When the bot is @-mentioned with a voice or video message, the system MUST download the media and obtain a transcript via a configured ASR endpoint (OpenAI-compatible). For video, the system MUST extract an audio track (or equivalent) before ASR when a track is present. The system MUST enforce configured size and timeout limits. On ASR/extract failure, size/timeout exceedance, or empty transcript, it MUST send the guidance reply and record a miss with the correct `media_type` (`voice` or `video`). Successful transcripts MUST enter the existing QA pipeline as text.

#### Scenario: Voice @-mention becomes a question

- **WHEN** a user @-mentions the bot with a voice clip and ASR succeeds
- **THEN** the transcript is answered by the QA orchestrator as text

#### Scenario: Video over size limit records miss

- **WHEN** a user @-mentions the bot with a video exceeding the configured max bytes
- **THEN** the system sends guidance, does not call QA, and records a miss with `media_type=video`

#### Scenario: Video ASR failure records miss

- **WHEN** video audio extraction or ASR fails
- **THEN** the system sends guidance and records a miss with `media_type=video`
