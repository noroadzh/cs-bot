# Spec Delta: qa-orchestration

## ADDED Requirements

### Requirement: Question normalization and input guards

Before QA, the system MUST strip bot mentions and configured trigger prefixes from the question text. Questions that are empty, punctuation-only, or longer than 500 characters MUST receive the guidance text without calling any model.

#### Scenario: Mention and prefix stripped

- **WHEN** a group member sends "客服：怎么开发票" where "客服：" is a trigger prefix
- **THEN** the QA engine receives "怎么开发票"

#### Scenario: Oversized question guarded

- **WHEN** the normalized question exceeds 500 characters
- **THEN** the user receives the guidance text and no LLM call is made

### Requirement: Answer source citations

When the knowledge base returns retrieval quotes, the reply MUST include at most two source citations in the form `—— 来源：《文档名》`.

#### Scenario: Citations appended

- **WHEN** an answer is produced with two or more retrieval quotes
- **THEN** the reply ends with at most two source citations

#### Scenario: No quotes no citation

- **WHEN** an answer is produced without retrieval quotes
- **THEN** the reply contains no citation line

### Requirement: Primary channel retry

The primary model channel MUST retry once with a short backoff before falling back to the secondary channel.

#### Scenario: Transient failure recovered

- **WHEN** the first primary call fails and the retry succeeds
- **THEN** the retry result is used and the fallback channel is not called
