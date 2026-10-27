# Spec Delta: media-recognition

## MODIFIED Requirements

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
