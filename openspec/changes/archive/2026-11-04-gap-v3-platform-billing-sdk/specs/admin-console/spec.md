## ADDED Requirements

### Requirement: Self-serve billing console

The platform (or dedicated self-serve) admin-web surface MUST expose `/register`, `/billing`, and `/billing/orders/:id` calling control-plane self-serve APIs. Mock channel MUST offer an explicit simulate-pay action calling the existing mock pay endpoint. When self-serve is disabled, the UI MUST surface the API `errCode`.

#### Scenario: Register then create order

- **WHEN** a user completes register on `/register`
- **THEN** the UI shows `tenantId` and can navigate to order creation on `/billing`

#### Scenario: Mock pay from UI

- **WHEN** the order channel is mock
- **THEN** simulate-pay succeeds and the UI polls order status until `paid`
