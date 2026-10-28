# Spec Delta

## ADDED Requirements

### Requirement: Upgrade window and advance notice

Batch upgrades MUST run inside the configured low-peak window (default 02:00–04:00 local time), and the control plane MUST send tenants an upgrade notice at least three business days before the window unless an operator explicitly overrides the window for an emergency.

#### Scenario: Upgrade outside the window is deferred

- **WHEN** an upgrade is scheduled outside the configured window without an override
- **THEN** it waits for the next window instead of starting immediately

#### Scenario: Advance notice sent

- **WHEN** an upgrade is scheduled for a future window
- **THEN** affected tenants receive a notice at least three business days before it

#### Scenario: Emergency override

- **WHEN** an operator explicitly overrides the window
- **THEN** the upgrade may run immediately and the override is recorded in the audit entry
