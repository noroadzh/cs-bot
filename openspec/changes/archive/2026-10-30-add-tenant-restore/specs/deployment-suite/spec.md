# Spec Delta

## ADDED Requirements

### Requirement: Tenant restore

The delivery MUST ship a restore script that reconstructs one tenant instance from its latest (or a named) backup, and MUST require explicit confirmation before changing any state.

#### Scenario: Dry run shows the plan

- **WHEN** the operator runs the restore script with `--dry-run`
- **THEN** it prints the tenant, backup timestamp, and the steps it would execute without touching any container or data

#### Scenario: Missing backup fails fast

- **WHEN** the tenant has no backup directory (or the named timestamp does not exist)
- **THEN** the script exits non-zero and names the missing path

#### Scenario: Restore requires confirmation

- **WHEN** the operator runs the script without `--yes`
- **THEN** it prints the plan and exits non-zero without stopping containers or restoring data
