# Spec Delta

## MODIFIED Requirements

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

### Requirement: Recognition API configuration

The system MUST read `QWEN_VL_BASE_URL`, `QWEN_VL_API_KEY`, and `QWEN_VL_MODEL` from configuration, use `QWEN_VL_MODEL` as the requested model, apply a 10-second recognition timeout, and default to a mock implementation in `USE_MOCK_LLM=true` mode.

#### Scenario: Mock mode uses local mock

- **WHEN** `USE_MOCK_LLM=true` is set
- **THEN** the system uses a built-in mock that returns a predefined description for testing purposes

#### Scenario: Production mode uses configured endpoint

- **WHEN** `USE_MOCK_LLM` is not set or is `false`
- **THEN** the system sends the request to `QWEN_VL_BASE_URL` with the configured key and `QWEN_VL_MODEL`
