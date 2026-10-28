# Spec Delta

## MODIFIED Requirements

### Requirement: Sensitive information redaction on parse

The system MUST redact seven categories of personal or contact-sensitive data from every parsed item's answer (and question) before storing it: mobile numbers, PRC ID numbers, bank card numbers, email addresses, URLs, detailed addresses, and personal names. The original text MUST remain available as `answer_raw`; the redacted text MUST be stored as `answer_redacted`.

#### Scenario: ID number redacted

- **WHEN** a parsed answer contains `11010119900307771X`
- **THEN** `answer_redacted` contains `<ID:1>` and `answer_raw` retains the original number

#### Scenario: Detailed address redacted

- **WHEN** a parsed answer contains a full street address
- **THEN** `answer_redacted` contains an `<ADDRESS:n>` placeholder and `answer_raw` retains the original text

#### Scenario: Personal name redacted

- **WHEN** a parsed answer contains a recognized personal name
- **THEN** `answer_redacted` contains a `<NAME:n>` placeholder and `answer_raw` retains the original text

#### Scenario: Redaction applies to questions too

- **WHEN** a parsed question contains an email address
- **THEN** the stored question text contains an `<EMAIL:n>` placeholder instead of the address

### Requirement: Typed redaction placeholders

Each redaction hit MUST be replaced in the redacted text with a typed placeholder `<TYPE:n>`, where `TYPE` is one of `PHONE`, `ID`, `CARD`, `EMAIL`, `URL`, `ADDRESS`, `NAME` and `n` is a per-item per-type occurrence counter starting at 1. `sensitive_flags` MUST be stored on the item as a JSON array holding each matched type once, in first-occurrence order.

#### Scenario: Mobile number redacted

- **WHEN** a parsed answer contains `请联系 13800138000`
- **THEN** `answer_redacted` contains `请联系 <PHONE:1>`, `sensitive_flags` includes `phone`, and `answer_raw` retains the original digits

#### Scenario: Multiple categories with ordered placeholders

- **WHEN** a parsed answer contains a mobile, an email, and a URL in that order
- **THEN** placeholders appear as `<PHONE:1>`, `<EMAIL:1>`, `<URL:1>` and `sensitive_flags` is `["phone", "email", "url"]`

#### Scenario: Repeated same-type hits increment the counter

- **WHEN** a parsed answer contains two different mobile numbers
- **THEN** `answer_redacted` contains `<PHONE:1>` and `<PHONE:2>` while `sensitive_flags` lists `phone` only once

#### Scenario: Clean answer is unchanged

- **WHEN** a parsed answer contains none of the seven categories
- **THEN** `answer_redacted` equals `answer_raw` and `sensitive_flags` is an empty array
