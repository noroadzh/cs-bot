# Spec Delta: media-management

## ADDED Requirements

### Requirement: Asset size, dedup, and storage permissions

File assets MUST be limited to 20 MB and video assets to 10 MB. Uploads MUST be deduplicated by MD5 and stored with owner-only permissions.

#### Scenario: Oversized video rejected

- **WHEN** an operator uploads a 15 MB video
- **THEN** the upload is rejected with a size-limit error

#### Scenario: Duplicate upload deduplicated

- **WHEN** the same file is uploaded twice
- **THEN** the existing asset is returned instead of storing a second copy

#### Scenario: Restricted file permissions

- **WHEN** an asset file is written to disk
- **THEN** its permissions are `0600`
