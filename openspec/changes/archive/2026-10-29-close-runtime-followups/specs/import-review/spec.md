# Spec Delta

## MODIFIED Requirements

### Requirement: Sensitive information redaction on parse

The system MUST redact seven categories of personal or contact-sensitive data from every parsed item's answer (and question) before storing it: mobile numbers, PRC ID numbers, bank card numbers, email addresses, URLs, detailed addresses, and personal names. Personal names MUST be detected both in labeled contexts (姓名/联系人/收货人) and through the configurable name dictionary `config/import-names.txt`; when the dictionary is absent, labeled detection remains in effect. The original text MUST remain available as `answer_raw`; the redacted text MUST be stored as `answer_redacted`.

#### Scenario: ID number redacted

- **WHEN** a parsed answer contains `11010119900307771X`
- **THEN** `answer_redacted` contains `<ID:1>` and `answer_raw` retains the original number

#### Scenario: Detailed address redacted

- **WHEN** a parsed answer contains a full street address
- **THEN** `answer_redacted` contains an `<ADDRESS:n>` placeholder and `answer_raw` retains the original text

#### Scenario: Personal name redacted

- **WHEN** a parsed answer contains `联系人：张三`
- **THEN** `answer_redacted` contains `<NAME:n>` and `answer_raw` retains the original text

#### Scenario: Dictionary name redacted without a label

- **WHEN** `config/import-names.txt` contains `张三` and a parsed answer mentions `张三`
- **THEN** the name is replaced with `<NAME:n>` even without a 姓名/联系人 label

#### Scenario: Missing dictionary keeps labeled detection

- **WHEN** `config/import-names.txt` does not exist
- **THEN** labeled names are still redacted and parsing continues

#### Scenario: Redaction applies to questions too

- **WHEN** a parsed question contains an email address
- **THEN** the stored question text contains an `<EMAIL:n>` placeholder instead of the address
