# Spec Delta: mock-qa-engine

## Purpose

Provides a deterministic, configurable, network-free QA engine used during development and pre-production integration so that the entire message pipeline (routing, context, sensitive filter, send) can be exercised without depending on a real FastGPT deployment.

## ADDED Requirements

### Requirement: Built-in example Q&A pairs
The system MUST ship with at least 10 hand-curated example Q&A pairs covering common customer questions (return policy, shipping, pricing, business hours, contact channels), each with a confidence score in the range [0.0, 1.0].

#### Scenario: Match against configured examples
- **WHEN** a user question has high lexical overlap with one of the configured examples
- **THEN** the engine returns that example's answer with `score` equal to the configured confidence

### Requirement: Runtime-configurable mock data
The system MUST load the mock Q&A pairs from a configurable file path (default `config/mock-qa.json`) at startup and on `POST /admin/config/reload`, allowing operators to add test scenarios without code changes.

#### Scenario: Config reload updates answers
- **WHEN** an admin modifies `config/mock-qa.json` and triggers a reload
- **THEN** subsequent `ask` calls use the new pairs without restarting the adapter

### Requirement: Mock engine no network calls
The system MUST guarantee that `MockQaEngine.ask` never opens a TCP connection to any external service and completes within 50ms for any input.

#### Scenario: Engine called in mock mode
- **WHEN** `USE_MOCK_LLM=true` and the orchestrator calls `ask`
- **THEN** no DNS lookup or HTTP request occurs, and the result is returned within 50ms
