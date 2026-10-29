# Spec Delta

## MODIFIED Requirements

### Requirement: Upgrade window and advance notice

Batch upgrades MUST run inside the configured low-peak window (default 02:00–04:00 local time), and the control plane MUST send tenants an upgrade notice at least three business days before the window unless an operator explicitly overrides the window for an emergency. The notice MUST be delivered through the tenant's contact channel; when a tenant has no contact channel, the control plane MUST fall back to the operations channel and record that fallback.

#### Scenario: Upgrade outside the window is deferred

- **WHEN** an upgrade is scheduled outside the configured window without an override
- **THEN** it waits for the next window instead of starting immediately

#### Scenario: Advance notice sent

- **WHEN** an upgrade is scheduled for a future window and the tenant has a contact channel
- **THEN** the tenant receives a notice at least three business days before it

#### Scenario: Missing contact falls back to operations

- **WHEN** a tenant has no contact channel
- **THEN** the notice goes to the operations channel and the fallback is recorded in the audit entry

#### Scenario: Emergency override

- **WHEN** an operator explicitly overrides the window
- **THEN** the upgrade may run immediately and the override is recorded in the audit entry
