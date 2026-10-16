# Spec Delta

## ADDED Requirements

### Requirement: Asset management endpoints

The system MUST expose `POST /admin/assets`, `GET /admin/assets`, and `DELETE /admin/assets/:id` under Basic Auth + IP whitelist protection, as defined in the `media-management` capability.

#### Scenario: Create asset via POST
- **WHEN** an operator posts a file to `POST /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 201 with the created asset's metadata

#### Scenario: List assets via GET
- **WHEN** an operator calls `GET /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 200 with a paginated list of assets

#### Scenario: Delete asset via DELETE
- **WHEN** an operator sends `DELETE /admin/assets/:id` with valid Basic Auth
- **THEN** the system returns HTTP 200 on success or HTTP 404 if not found

### Requirement: Usage reporting endpoint

The system MUST expose `GET /admin/usage` under Basic Auth + IP whitelist protection, returning the current period's usage counters as defined in the `usage-reporting` capability.

#### Scenario: Query usage
- **WHEN** an operator calls `GET /admin/usage` with valid Basic Auth
- **THEN** the system returns HTTP 200 with the usage counters and period info

#### Scenario: Query usage with period parameter
- **WHEN** an operator calls `GET /admin/usage?period=weekly` with valid Basic Auth
- **THEN** the system returns HTTP 200 with the weekly aggregation