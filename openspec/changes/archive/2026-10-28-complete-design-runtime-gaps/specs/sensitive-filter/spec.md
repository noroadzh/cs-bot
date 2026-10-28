# Spec Delta

## MODIFIED Requirements

### Requirement: Aho-Corasick multi-pattern matching

The system MUST build an Aho-Corasick automaton from `config/sensitive-words.txt` (one word per line, UTF-8) and use it to scan every outbound answer text. Build time MUST stay under 50ms for a 10,000-word dictionary. When any word matches, the entire outbound answer MUST be replaced with the fixed text `抱歉，该内容不便回复，请联系人工客服。`; the system MUST log hit metadata without the full original text.

#### Scenario: Word matches

- **WHEN** the outbound text contains any word from the dictionary
- **THEN** the whole answer is replaced with `抱歉，该内容不便回复，请联系人工客服。` and an audit log entry records hit metadata but not the full original text

#### Scenario: No match

- **WHEN** the outbound text contains no dictionary word
- **THEN** the system returns the text unchanged
