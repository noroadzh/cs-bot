# license-bind Specification

## Purpose
Provides the delivery layer for the M9 license system: an operator-facing `license` CLI
for issuing and verifying license files, and a verified Docker build that produces a
genuine Linux ELF native module (not the macOS Mach-O artifact produced by local builds).

This spec is merged into the main `license-skeleton` spec as requirement M9-Bind-Deployment.

## Requirements

### Requirement: Operator license CLI
The system MUST provide a `license` CLI exposed via the `@cs-bot/license-native` package `bin` entry, supporting the subcommands:

1. `license issue` — signs a license payload and writes it to disk:
   - Accepts `--fingerprint <sha256-hex>`, `--expires-at <ISO8601>`, `--max-chats <n>`, `--output <path>`, and the shorthand `--days <n>`
   - When `--fingerprint` is omitted, the tool MUST compute it from the current host via the native `fingerprint()` function
   - Reads the Ed25519 private key from `test_keys/signing.pem`
   - Emits `<base64(payload_json)>.<base64(signature)>`
   - MUST refuse to overwrite an existing output file unless `--force` is passed
2. `license verify <path>` — parses and verifies an existing license file, printing `{valid, reason, expiresAtMs, maxChats, daysLeft}` as JSON to stdout
3. Exit codes: `0` for a valid license, `1` for an invalid license or a usage error

The CLI MUST surface a non-zero exit and a human-readable message when the native module cannot be loaded, rather than throwing an unhandled exception.

Source: SHA-3.1.15

#### Scenario: Issue with explicit fingerprint
- **WHEN** `license issue` is called with `--fingerprint <hex>` and a future `--expires-at`
- **THEN** the output file contains a `<base64(payload_json)>.<base64(signature)>` string carrying that fingerprint

#### Scenario: Issue derives fingerprint from host
- **WHEN** `license issue` is called without `--fingerprint`
- **THEN** the tool computes the fingerprint from the current host via `fingerprint()` and embeds it in the payload

#### Scenario: Refuse to overwrite without --force
- **WHEN** the output file already exists and `--force` is not passed
- **THEN** `license issue` refuses to overwrite and exits non-zero with a human-readable message

#### Scenario: Verify prints structured JSON
- **WHEN** `license verify <path>` is given a valid license file
- **THEN** it prints `{valid, reason, expiresAtMs, maxChats, daysLeft}` as JSON to stdout and exits `0`

#### Scenario: Native module fails to load
- **WHEN** the CLI cannot load the native module
- **THEN** it surfaces a non-zero exit and a human-readable message instead of throwing an unhandled exception

### Requirement: Docker build produces Linux ELF module
The `deploy/Dockerfile.adapter` build MUST produce a native module that is a Linux ELF object for the runtime platform.

1. A `native` build stage MUST compile the Rust crate for `x86_64-unknown-linux-gnu` with `--release` (which applies `strip = "symbols"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`, `opt-level = "z"`)
2. The compiled artifact MUST be copied into the runtime image at `/app/packages/license-native/prebuilds/linux-x64-gnu/index.node`, overwriting any platform-mismatched artifact shipped from the repository
3. The artifact MUST pass `file` inspection as `ELF 64-bit LSB shared object, x86-64`
4. `deploy/test-docker-build.sh` MUST build the `runtime` target and assert the artifact's file type, failing with a non-zero exit if the output is not ELF

Source: SHA-3.1.16

#### Scenario: Native stage compiles for Linux GNU
- **WHEN** the `native` build stage runs
- **THEN** it compiles the Rust crate for `x86_64-unknown-linux-gnu` with `--release` and the five hardening flags applied

#### Scenario: Runtime image carries the ELF artifact
- **WHEN** the runtime image is assembled
- **THEN** the compiled artifact is present at `/app/packages/license-native/prebuilds/linux-x64-gnu/index.node`, overwriting any shipped platform-mismatched artifact

#### Scenario: Artifact file type assertion
- **WHEN** the built artifact is inspected with `file`
- **THEN** it reports `ELF 64-bit LSB shared object, x86-64`

#### Scenario: Docker build verification script
- **WHEN** `deploy/test-docker-build.sh` builds the `runtime` target
- **THEN** it asserts the artifact's file type and exits non-zero if the output is not ELF

### Requirement: End-to-end license lifecycle test
`deploy/test-license-flow.sh` MUST verify the end-to-end license lifecycle:

1. Generate a license file with a future expiry via `license issue`
2. Build the `runtime` image
3. Start the container with the license directory mounted at `/app/license`
4. Assert the logs contain the `license-ok` marker and `/health` returns HTTP 200
5. Stop and remove the container on any failure path

Source: SHA-3.1.17

#### Scenario: Healthy licensed container
- **WHEN** a container is started with a valid future-expiry license mounted at `/app/license`
- **THEN** its logs contain the `license-ok` marker and `/health` returns HTTP 200

#### Scenario: Cleanup on failure
- **WHEN** any assertion in the lifecycle test fails
- **THEN** the script stops and removes the container before exiting non-zero
