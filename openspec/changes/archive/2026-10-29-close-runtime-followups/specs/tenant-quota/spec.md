# Spec Delta

## ADDED Requirements

### Requirement: Capacity quota enforcement

The system MUST enforce the tenant's `maxAssetMb`, `maxQa`, and `maxDocs` quotas at the data plane: asset upload MUST be rejected when the new file would exceed `maxAssetMb`; import confirmation MUST be rejected when the approved items would exceed `maxQa` or `maxDocs`. A limit of `0` MUST mean unlimited. Rejections MUST return HTTP 409 with an error naming the exceeded dimension and the current limit, and MUST NOT persist the upload or import.

#### Scenario: Asset upload within quota

- **WHEN** a tenant with `maxAssetMb=100` has 90 MB of assets and uploads a 5 MB file
- **THEN** the upload succeeds and the stored usage becomes 95 MB

#### Scenario: Asset upload exceeds quota

- **WHEN** the same tenant uploads a 20 MB file
- **THEN** the system returns HTTP 409 naming `maxAssetMb` and stores no file

#### Scenario: Import confirmation exceeds QA quota

- **WHEN** a tenant with `maxQa=100` has 90 approved QA and confirms 20 more
- **THEN** the system returns HTTP 409 naming `maxQa` and writes nothing to the dataset

#### Scenario: Import confirmation exceeds document quota

- **WHEN** a tenant with `maxDocs=50` has 45 documents and confirms an import that would add 10
- **THEN** the system returns HTTP 409 naming `maxDocs` and writes nothing

#### Scenario: Zero means unlimited

- **WHEN** a tenant has `maxAssetMb=0` and uploads any allowed-size file
- **THEN** the capacity check admits it
