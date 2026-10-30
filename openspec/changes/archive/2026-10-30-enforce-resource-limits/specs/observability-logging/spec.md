# Spec Delta

## ADDED Requirements

### Requirement: WeCom signature failure alert

A failed WeCom callback signature MUST be rejected with HTTP 401 AND raise an operational alert. Alerts MUST be throttled by a cooldown so a misconfiguration storm produces at most one alert per window, and alert delivery failure MUST NOT change the 401 response.

#### Scenario: Signature failure alerts once

- **WHEN** callbacks arrive with an invalid signature
- **THEN** each is rejected with 401 and one alert is sent for the cooldown window

#### Scenario: Alert failure does not affect the response

- **WHEN** the operations webhook is unreachable
- **THEN** the callback still receives 401 and the delivery failure is logged as a warning
