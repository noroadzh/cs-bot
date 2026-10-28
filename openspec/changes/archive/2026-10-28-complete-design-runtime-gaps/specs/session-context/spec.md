# Spec Delta

## MODIFIED Requirements

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
