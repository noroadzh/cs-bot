# Spec Delta

## ADDED Requirements

### Requirement: Non-root container runtime

The delivered adapter and control-plane images MUST run as a non-root UID/GID by default (default 65532), and the compose files MUST NOT default to UID 0. Mounted data, logs, and license directories MUST be writable by that user, and an operator MUST be able to override the UID/GID through `CSBOT_UID`/`CSBOT_GID` for host-directory ownership constraints.

#### Scenario: Default containers are non-root

- **WHEN** an operator runs the compose stack without setting `CSBOT_UID`
- **THEN** the adapter and control-plane processes report a non-zero UID

#### Scenario: Writable mounts

- **WHEN** the non-root adapter writes a log line, an imported file, and a license file under its mounted directories
- **THEN** all three writes succeed

#### Scenario: Explicit UID override

- **WHEN** an operator sets `CSBOT_UID=1500` and `CSBOT_GID=1500`
- **THEN** both containers run with those IDs and the operator can align host directory ownership
