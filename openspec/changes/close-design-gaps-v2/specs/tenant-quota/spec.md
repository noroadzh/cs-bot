# Spec Delta: tenant-quota

## ADDED Requirements

### Requirement: Quota utilization warning

When any quota dimension reaches 80% of its limit, the platform MUST notify the tenant and operations at most once per day per dimension, without blocking service.

#### Scenario: 80 percent warning

- **WHEN** daily messages reach 80% of `max_msgs_per_day`
- **THEN** a warning is emitted once that day and messages continue to be served

#### Scenario: No duplicate warnings

- **WHEN** the same dimension stays above 80% for the rest of the day
- **THEN** no further warning is sent that day
