# Spec Delta

## ADDED Requirements

### Requirement: Subscription reminders use the tenant contact

Expiry reminders at 30, 15, and 7 days MUST be emailed to the tenant contact when it contains an email address. Operators MUST still be notified on the ops webhook. When SMTP_HOST is set, email MUST be sent over SMTP; otherwise EMAIL_WEBHOOK_URL MAY be used. A missing contact MUST skip tenant email without failing the sweep.

#### Scenario: Contact receives the reminder

- **WHEN** a tenant is due for a T-30, T-15, or T-7 reminder and contact is an email address
- **THEN** the mail notifier is called with that address

#### Scenario: Missing contact skips mail

- **WHEN** a due tenant has no email contact
- **THEN** no tenant email is sent and the ops notifier is still called
