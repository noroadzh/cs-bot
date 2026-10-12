# config-management Specification

## Purpose
Centralizes all runtime configuration loading with strong type safety, fail-fast startup behavior, and runtime reloadability of non-secret knobs.

## Requirements

### Requirement: zod-validated startup
The system MUST validate every required env var against a zod schema at startup. If any var is missing or fails format validation, the system MUST print a list of missing keys with masked values and exit with code 1.

#### Scenario: All vars valid
- **WHEN** every required env var matches its zod schema
- **THEN** the system continues startup

#### Scenario: Missing required var
- **WHEN** a required env var is empty
- **THEN** the system prints `{key, present: false}` for each missing var and `process.exit(1)` before HTTP listen

#### Scenario: Format validation fails
- **WHEN** `WECHAT_AES_KEY` is not exactly 43 characters
- **THEN** the system prints a format error and exits

### Requirement: FastGPT credentials required regardless of mock
The system MUST require `FASTGPT_API_KEY` to be present and non-empty even when `USE_MOCK_LLM=true`, but MUST NOT make any HTTP call to the FastGPT endpoint while in mock mode.

#### Scenario: FastGPT key present, mock mode
- **WHEN** `USE_MOCK_LLM=true` and `FASTGPT_API_KEY` is set
- **THEN** startup succeeds and no network calls to FastGPT occur

#### Scenario: FastGPT key missing
- **WHEN** `FASTGPT_API_KEY` is empty
- **THEN** startup fails regardless of `USE_MOCK_LLM` value

### Requirement: Group count cap validation
The system MUST reject the startup configuration if `chats.length > maxChats` from the license, refusing new group additions while keeping existing ones running.

#### Scenario: Within license cap
- **WHEN** the configured chat count is ≤ `maxChats`
- **THEN** startup continues

#### Scenario: Exceeds license cap
- **WHEN** the configured chat count is > `maxChats`
- **THEN** the system logs WARN with the over-cap count and refuses new group additions (existing groups continue working)
