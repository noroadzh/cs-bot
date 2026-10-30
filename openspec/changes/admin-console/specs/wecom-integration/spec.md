# Spec Delta

## MODIFIED Requirements

### Requirement: Passive reply with 3.5s active-push race

The 3.5-second passive window applies only when the decrypted message has no ChatId and group-chat id is not required. A message that includes ChatId MUST be acknowledged with an empty body immediately and answered by an active send. When an active send is used, each text segment MUST use `client_msg_id` `${traceId}:${segmentIndex}` so WeCom does not treat later segments as duplicates of the first.

#### Scenario: Answer ready before 3.5s

- **WHEN** a message without ChatId produces an answer within 3.5 seconds of the callback
- **THEN** the system returns the answer as the passive XML reply and does not also send that text actively

#### Scenario: Answer after 3.5s

- **WHEN** a message without ChatId takes longer than 3.5 seconds
- **THEN** the system returns an empty success body and pushes each segment via active send with `client_msg_id` `${traceId}:${segmentIndex}`
