# Spec Delta: miss-record

## ADDED Requirements

### Requirement: Media type and processing status metadata

Miss records MUST store the triggering media type (`voice`/`video`/`file`, empty for text) and a processing status (`0` unhandled, `1` learned, `2` ignored). Existing export paths MUST include both fields, and existing rows MUST remain valid after the schema extension.

#### Scenario: Media miss persisted

- **WHEN** a voice message addressed to the bot is recorded
- **THEN** the stored row has `media_type=voice` and default status `0`

#### Scenario: Export includes status

- **WHEN** an operator exports miss records as JSON or xlsx
- **THEN** each row includes `mediaType` and `status`
