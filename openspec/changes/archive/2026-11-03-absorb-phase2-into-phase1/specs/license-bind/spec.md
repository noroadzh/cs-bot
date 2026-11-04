## MODIFIED Requirements

### Requirement: Mock license skips only signature and antireplay

When `USE_MOCK_LICENSE=true`, the verifier MUST still enforce license file format, expiry, and host fingerprint binding. The message gate MUST NOT unconditionally allow traffic solely because mock mode is on. Signature verification and antireplay MAY be skipped.

#### Scenario: Mock mode rejects fingerprint mismatch

- **WHEN** mock mode is on and the license fingerprint does not match the host
- **THEN** the gate enters restricted mode and does not call QA
