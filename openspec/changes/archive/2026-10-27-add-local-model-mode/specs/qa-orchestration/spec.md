# Spec Delta: qa-orchestration

## ADDED Requirements

### Requirement: Model mode aware QA routing

The QA orchestration MUST select its LLM channel and degradation path according to `MODEL_MODE` (cloud / hybrid / local), delegating channel selection to the model-routing capability.

#### Scenario: Routing follows model mode

- **WHEN** `MODEL_MODE=hybrid`
- **THEN** QA orchestration prefers local inference and falls over to cloud on failure
