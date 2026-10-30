# Spec Delta

## ADDED Requirements

### Requirement: FastGPT admin console access

The baseline deployment MUST expose the FastGPT admin console through nginx on a dedicated port that is denied by default and reachable only from operator-configured CIDRs.

#### Scenario: Default denies every client

- **WHEN** the baseline stack runs without any allow-list configured
- **THEN** requests to the admin port are rejected for all client addresses

#### Scenario: Configured CIDR can reach the console

- **WHEN** an operator configures one or more CIDRs and re-runs the installer
- **THEN** clients inside those CIDRs reach the FastGPT admin console and others are still denied

#### Scenario: Console is not on the public entry port

- **WHEN** the stack is inspected for published ports
- **THEN** the admin console is served on its own port, separate from the callback port 443
