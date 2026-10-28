# Spec Delta

## ADDED Requirements

### Requirement: Chat limit rejection alert

When a new group is rejected because the license `maxChats` limit is reached, the system MUST send an alert to the operations webhook, in addition to logging the rejection and replying to the group. Alerts for the same rejected group MUST be deduplicated within 24 hours.

#### Scenario: New group rejected at limit

- **WHEN** a new group is admitted while the licensed chat count already equals `maxChats`
- **THEN** the admission is rejected, the group receives the chat-limit guidance, and an operations alert is sent

#### Scenario: Alert deduplicated

- **WHEN** the same group retries within 24 hours
- **THEN** no second alert is sent for that group
