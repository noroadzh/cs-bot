# session-context Specification

## Purpose
Maintains per-user, per-group conversation history in Redis so the bot can answer follow-up questions with awareness of the last few exchanges.

## Requirements

### Requirement: Context storage with sliding 5-round window

The system MUST store the last `CONTEXT_ROUNDS` conversation rounds (each round = 1 question + 1 answer, default 5) per `(chatId, userId)` pair in Redis as a JSON array under key `ctx:{chatId}:{userId}`, with TTL `CONTEXT_TTL_SEC` (default 600 seconds) refreshed on every write.

#### Scenario: First interaction

- **WHEN** a user asks their first question in a group
- **THEN** the system creates an empty context array and stores it under the corresponding key with the configured TTL

#### Scenario: Fifth round append

- **WHEN** a user asks a question and the context already has `CONTEXT_ROUNDS` rounds
- **THEN** the system drops the oldest round and appends the new round; TTL is reset

#### Scenario: Configured rounds respected

- **WHEN** `CONTEXT_ROUNDS=3`
- **THEN** the stored context retains at most three question/answer rounds

#### Scenario: TTL expires

- **WHEN** no write occurs within the configured TTL
- **THEN** the Redis key expires and the next interaction starts with an empty context

### Requirement: Context fail-open on Redis failure
The system MUST return an empty context (not raise an exception) when the Redis read or write fails, and log a WARN-level structured log with `ErrCode.REDIS_FAIL`.

#### Scenario: Redis unreachable
- **WHEN** the Redis client throws a connection error during context read
- **THEN** the system returns an empty history array to the orchestrator and continues processing

### Requirement: Context write atomicity
The system MUST append a question-answer pair to the context only after the answer is successfully sent, so a failed send does not pollute the history with an unanswered question.

#### Scenario: Answer send succeeds
- **WHEN** the outbound `WecomClient.sendText` call succeeds
- **THEN** the system appends the `(question, answer)` pair and refreshes the TTL

#### Scenario: Answer send fails
- **WHEN** the outbound send call returns an error
- **THEN** the system does NOT write to the context and logs `ErrCode.WECOM_*` at WARN level
