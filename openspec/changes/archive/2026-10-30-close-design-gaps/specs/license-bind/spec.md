# Spec Delta

## ADDED Requirements

### Requirement: Production signing key is external

The control-plane shell issuer MUST invoke the delivery CLI with `--key`, `--fingerprint`, `--expires`, and `--max-chats`. In production, a key path under the repository `test_keys` directory MUST be rejected. When `LICENSE_SIGN_CMD` is set, the issuer MUST pass the payload JSON to that command on stdin and use the stdout signature instead of reading a PEM.

#### Scenario: Shell issuer arguments match the delivery CLI

- **WHEN** a tenant license is issued with the shell issuer and no sign command
- **THEN** the process arguments include `--key`, `--fingerprint`, `--expires`, and `--max-chats`, and do not start with the subcommand `issue`

#### Scenario: Test key rejected in production

- **WHEN** NODE_ENV is production and the key path points at `packages/license-native/test_keys`
- **THEN** issuance fails before a license file is written

#### Scenario: External sign command

- **WHEN** LICENSE_SIGN_CMD is set
- **THEN** the payload JSON is written to the command stdin and the license signature is the command stdout
