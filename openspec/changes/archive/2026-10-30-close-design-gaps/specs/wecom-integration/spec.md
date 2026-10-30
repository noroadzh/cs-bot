# Spec Delta

## ADDED Requirements

### Requirement: Single-chat passive reply window

When a decrypted message has no ChatId and group-chat id is not required, the callback MUST wait up to 3.5 seconds for the reply text. If the text is ready, the HTTP response MUST be an encrypted passive reply and MUST NOT also send that text actively. If the wait expires, the HTTP response MUST be an empty acknowledgement and the reply MUST be sent actively.

#### Scenario: Group chat still acknowledges immediately

- **WHEN** the message includes a ChatId
- **THEN** the callback responds with an empty body and sends the answer actively

#### Scenario: Single chat replies inside the window

- **WHEN** a message without ChatId produces reply text before the passive window ends
- **THEN** the HTTP body is the encrypted passive reply and the active send is not used for that text

#### Scenario: Single chat falls back after timeout

- **WHEN** reply text is not ready before the passive window ends
- **THEN** the callback returns an empty acknowledgement and the text is sent actively afterward

#### Scenario: Missing ChatId is dropped when group id is required

- **WHEN** REQUIRE_GROUP_CHAT_ID is true and ChatId is absent
- **THEN** the message is counted as dropped and is not dispatched
