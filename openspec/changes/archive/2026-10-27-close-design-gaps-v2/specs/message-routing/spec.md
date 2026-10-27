# Spec Delta: message-routing

## ADDED Requirements

### Requirement: Configured group allowlist

The system MUST process messages only from configured customer groups when an allowlist is configured. Messages from other groups MUST be silently ignored with no reply and no persistence.

#### Scenario: Non-target group ignored

- **WHEN** a message arrives from a group not in the allowlist
- **THEN** the system does not reply and writes no miss or usage record

### Requirement: Rate-limit feedback

When a group exceeds 20 messages per minute it MUST remain silent but MAY send at most one hint per 5 minutes; when a user exceeds 5 messages per minute the user MUST receive the "提问太频繁，请稍后再试" hint.

#### Scenario: User over limit notified

- **WHEN** the same user exceeds 5 messages in one minute
- **THEN** the user receives the frequency hint

### Requirement: Redis-degraded dedup fallback

When Redis is unavailable, duplicate suppression MUST fall back to an in-process TTL cache so that a repeated message is still processed at most once.

#### Scenario: Duplicate suppressed without Redis

- **WHEN** Redis errors and the same message ID is delivered twice
- **THEN** only one reply is produced

### Requirement: Outbound concurrency limits

Outbound calls MUST be bounded by configurable semaphores: LLM (default 4), WeCom send (default 8), and vision (default 2), with FIFO queueing.

#### Scenario: LLM concurrency capped

- **WHEN** more concurrent questions than the LLM limit arrive
- **THEN** excess calls queue instead of exceeding the configured concurrency
