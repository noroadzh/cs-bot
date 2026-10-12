# sensitive-filter Specification

## Purpose
Catches outbound content that contains forbidden words from a hot-reloadable word list and replaces the offending segment with a safe phrase before any message reaches the group chat.

## Requirements

### Requirement: Aho-Corasick multi-pattern matching
The system MUST build an Aho-Corasick automaton from `config/sensitive-words.txt` (one word per line, UTF-8) and use it to scan every outbound answer text. Build time MUST stay under 50ms for a 10,000-word dictionary.

#### Scenario: Word matches
- **WHEN** the outbound text contains any word from the dictionary
- **THEN** the system replaces the matched segment with `[内容已过滤]` and appends an audit log entry containing `{hitWord, chatId, userIdHash, ts}` but NOT the full original text

#### Scenario: No match
- **WHEN** the outbound text contains no dictionary word
- **THEN** the system returns the text unchanged

### Requirement: Word list hot reload
The system MUST watch `config/sensitive-words.txt` with `fs.watch`, debounce change events by 500ms, and atomically swap the active automaton reference without disrupting in-flight sweeps.

#### Scenario: Operator edits the file
- **WHEN** an operator appends a word to `sensitive-words.txt`
- **THEN** within 1 second, the new word is matched by subsequent outbound scans

#### Scenario: Reload during sweep
- **WHEN** a reload happens while a sweep is mid-execution
- **THEN** the in-flight sweep finishes using the old automaton; the next sweep uses the new one
