## ADDED Requirements

### Requirement: Billing settlement audit entries

Control-plane billing settlement (mock pay and provider webhook mark-paid) MUST write an audit entry that includes order id, tenant id, channel, and outcome without storing payment credentials or full card/account secrets.

#### Scenario: Webhook paid audited

- **WHEN** a verified provider webhook marks an order paid
- **THEN** an audit entry for billing settlement is recorded with order and tenant identifiers
