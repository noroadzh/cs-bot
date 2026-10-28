# tenant-upgrade Specification

## Purpose
定义租户实例的批量升级与灰度交付：批次化升级、金丝雀观察、升级前快照与失败自动回滚，使平台能在不停机误伤的前提下统一推版本。

## Requirements

### Requirement: Batch upgrade with canary

The system MUST provide `POST /platform/upgrades` that upgrades instances in batches of ≤10%, using a canary instance first, observing for 24 hours before proceeding to the remaining batches.

#### Scenario: Canary before rollout

- **WHEN** an operator triggers an upgrade
- **THEN** the canary instance is upgraded and observed before other instances are upgraded

### Requirement: Pre-upgrade snapshot

The system MUST create a snapshot (pg_dump + data directory) for each tenant before replacing its image.

#### Scenario: Snapshot before image swap

- **WHEN** a tenant enters upgrade
- **THEN** a snapshot is created before its image is replaced

### Requirement: Automatic rollback on failure

The system MUST automatically roll back a failed upgrade to the previous image and snapshot, and MUST record the failure.

#### Scenario: Failed upgrade rolls back

- **WHEN** post-upgrade health checks fail
- **THEN** the instance is rolled back to the previous image and snapshot and the failure is recorded

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
