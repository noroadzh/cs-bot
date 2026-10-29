# Spec Delta

## ADDED Requirements

### Requirement: LLM dual-channel failure alerting

When both LLM channels fail, the system MUST reply with the busy message AND raise an operational alert. Alerts MUST be throttled so repeated failures within a cooldown window produce at most one alert, and alert delivery failure MUST NOT affect the QA path.

#### Scenario: Both channels fail raises one alert

- **WHEN** the primary and fallback LLM calls both fail
- **THEN** the user receives the busy message and one alert is sent to the operations webhook

#### Scenario: Repeated failures are throttled

- **WHEN** further dual-channel failures occur inside the cooldown window
- **THEN** no additional alert is sent until the cooldown elapses

#### Scenario: Alert delivery failure is contained

- **WHEN** the operations webhook is unreachable
- **THEN** the QA path still returns the busy message and the delivery failure is logged as a warning
