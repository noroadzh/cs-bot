# message-routing Specification

## Purpose
Decides which incoming WeCom messages should be processed by the bot and which should be silently ignored, while protecting the system from duplicate replays and excessive request rates.

## Requirements

### Requirement: Message deduplication via Redis SETNX
The system MUST deduplicate every incoming message by its `MsgId` using a `SETNX dedup:{msgid}` write with TTL 172800 seconds. A return value of 0 (already exists) MUST terminate processing silently.

#### Scenario: First-time message
- **WHEN** a new `MsgId` arrives
- **THEN** the `SETNX` succeeds, returns 1, and processing continues

#### Scenario: Duplicate message within 48h
- **WHEN** the same `MsgId` arrives again within 48 hours
- **THEN** the `SETNX` returns 0 and the system terminates processing with `ErrCode.DEDUP_DUP`

### Requirement: Trigger evaluation order
The system MUST evaluate trigger conditions in this exact order, short-circuiting on first match: (1) ignore if message is from the bot itself or another application; (2) ignore if `msgType` is not `text` and the message does not @-mention the bot; (3) accept if @-mentioned; (4) accept if any keyword from `keywords.yml` matches.

#### Scenario: Self-message ignored
- **WHEN** the message author is the bot's own user ID
- **THEN** the system ignores the message silently

#### Scenario: Non-text message without @ ignored
- **WHEN** the message type is `image`, `voice`, `video`, or `file` and the message does not @-mention the bot
- **THEN** the system ignores the message with `ErrCode.NOT_TRIGGERED`

#### Scenario: @-mention triggers
- **WHEN** the message contains an @-mention of the bot in its mention list
- **THEN** the system enters the orchestration pipeline

#### Scenario: Keyword triggers
- **WHEN** the message text matches any prefix in the configured keyword Trie
- **THEN** the system enters the orchestration pipeline

#### Scenario: Plain chat ignored
- **WHEN** the message contains no @-mention and matches no keyword
- **THEN** the system returns `ErrCode.NOT_TRIGGERED` silently

### Requirement: Token-bucket rate limiting
The system MUST enforce rate limits using a Lua script `tokenbucket.lua` executed atomically in Redis: group-level 20 messages per minute, user-level within a group 5 messages per minute.

#### Scenario: Group limit exceeded
- **WHEN** a group exceeds 20 messages in the current minute window
- **THEN** the system silently ignores the message and shows a "too busy" notice to the group at most once every 5 minutes

#### Scenario: User limit exceeded
- **WHEN** a user in a group exceeds 5 messages in the current minute window
- **THEN** the system replies with a "提问太频繁" message and returns `ErrCode.RATE_LIMITED`

### Requirement: Keyword trie hot reload
The system MUST support a `POST /admin/keywords/reload` endpoint that atomically rebuilds the in-memory keyword Trie from `config/keywords.yml` without dropping in-flight requests.

#### Scenario: Successful reload
- **WHEN** an admin calls `POST /admin/keywords/reload` with a valid keywords file
- **THEN** the system replaces the active Trie reference and returns the count of loaded keywords

#### Scenario: Reload mid-flight
- **WHEN** a reload happens while a message is being routed
- **THEN** the in-flight message uses the old Trie; subsequent messages use the new Trie
