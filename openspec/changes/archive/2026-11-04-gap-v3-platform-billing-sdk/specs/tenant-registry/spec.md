## MODIFIED Requirements

### Requirement: Self-serve registration and billing

The control plane MUST provide self-serve tenant registration (email verification MAY be placeholder), WeChat/Alipay payment configuration via environment variables, and renew orders persisted in durable storage. When WeChat or Alipay credentials are configured, creating an order with `channel=wechat|alipay` MUST return provider prepay artifacts and MUST NOT mark the order paid until a verified provider webhook (or signed callback) succeeds. Webhooks MUST verify signature/amount/`orderId`, then call the existing mark-paid → tenant renew path with billing audit, and MUST be idempotent on duplicate notifications. When payment credentials are absent, a mock/sandbox channel MUST still allow marking an order paid via the existing pay endpoint. Successful payment MUST call the existing tenant renew flow and record a billing audit entry.

#### Scenario: Paid renew extends subscription

- **WHEN** payment for a renew order succeeds (including mock/sandbox pay or verified provider webhook)
- **THEN** the control plane persists the order as paid, invokes tenant renew for the paid days, and records a billing audit entry

#### Scenario: Order durable across process restart

- **WHEN** a renew order is created
- **THEN** it is stored in the control-plane database (not only process memory) and can be loaded by id afterward

#### Scenario: Real channel prepay without immediate paid

- **WHEN** payment env is configured and the client creates an order with `channel=wechat` or `alipay`
- **THEN** the order stays `created`, the response includes prepay artifacts, and renew does not run until webhook settlement

#### Scenario: Invalid webhook rejected

- **WHEN** a provider webhook has invalid signature or amount mismatch
- **THEN** order state does not change and the response uses `{ errCode: 'PAYMENT_SIGNATURE_INVALID' }` or `PAYMENT_AMOUNT_MISMATCH`
