# Spec Delta: deployment-suite

## ADDED Requirements

### Requirement: Log persistence and rotation

The deployment suite MUST support logs on stdout (queryable via `docker logs`) and an optional file sink (`LOG_FILE`) rotated by `logrotate` daily/size with a retention window; the deployment manual MUST document `docker logs` and file-log troubleshooting for hosts without SSH.

#### Scenario: Logs queryable without SSH

- **WHEN** the server cannot be reached over SSH
- **THEN** operators can locate issues via `docker logs adapter` or the mounted log file

#### Scenario: Rotation configured

- **WHEN** a log file exceeds the rotation threshold
- **THEN** logrotate rotates it and keeps the configured retention
