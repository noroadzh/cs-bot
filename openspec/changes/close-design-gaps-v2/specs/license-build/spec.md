# Spec Delta: license-build

## ADDED Requirements

### Requirement: Delivery-side license issuer tool

The delivery side MUST provide a CLI that signs license payloads with the issuer private key and emits the compact `base64(payload).base64(signature)` format accepted by the runtime verifier. The tool and private key MUST NOT be included in runtime images.

#### Scenario: Issue a license

- **WHEN** the issuer tool is given a payload with fingerprint, expiry, and max chats
- **THEN** it emits a license file that the native verifier accepts

#### Scenario: Not shipped at runtime

- **WHEN** inspecting the adapter runtime image
- **THEN** no issuer tool or private key is present
