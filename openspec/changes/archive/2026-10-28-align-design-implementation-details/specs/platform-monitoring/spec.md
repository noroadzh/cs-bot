# Spec Delta

## MODIFIED Requirements

### Requirement: Anomaly auto-restart and alert

The system MUST run a periodic health sweep over every non-terminated tenant, MUST automatically restart an instance after its health check fails on consecutive sweeps (default 2), and MUST emit an alert when a restart is attempted or when the instance cannot be recovered. Sweeps MUST be bounded: at most a configurable number of restarts per tenant per hour (default 3) with exponential backoff between attempts. Every restart attempt and alert MUST be recorded in the platform audit log with the tenant id and outcome. A failed restart MUST NOT abort the sweep or crash the process, and the sweep MUST be skipped safely when no restart handler is configured.

#### Scenario: Unhealthy instance restarted

- **WHEN** an instance's health check fails on the configured number of consecutive sweeps
- **THEN** the platform restarts it and records an alert and a restart audit entry naming the tenant

#### Scenario: Single failed probe does not restart

- **WHEN** an instance fails one probe and succeeds on the next
- **THEN** no restart is attempted

#### Scenario: Restart storm is capped

- **WHEN** an instance keeps failing after reaching the per-hour restart limit
- **THEN** the platform stops restarting it, records an unrecoverable alert, and continues probing other tenants

#### Scenario: Restart handler absent

- **WHEN** the monitor runs without a configured restart handler
- **THEN** it still collects metrics, emits alerts for unhealthy tenants, and performs no restart
