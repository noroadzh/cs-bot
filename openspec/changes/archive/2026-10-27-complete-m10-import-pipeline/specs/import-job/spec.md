# Spec Delta: import-job

## MODIFIED Requirements

### Requirement: Import job parsing into question-answer items

The system MUST parse an `uploaded` job's stored bytes into question/answer items asynchronously. For directly-paired formats (`.txt` Q:/A:, `.csv`/`.xlsx` with `question,answer` header, `.json` array) it stores each pair as `pending`. For conversation shapes (wecom archive / three-column table) it MUST clean, then split and pair, before storing items. Status goes `parsing` → `parsed`, or `failed` on unrecoverable errors.

#### Scenario: TXT Q/A block parsing

- **WHEN** an uploaded `.txt` contains three `Q:`/`A:` blocks separated by blank lines
- **THEN** the job becomes `parsed` with `item_count: 3` and three `import_item` rows in `pending` status

#### Scenario: CSV with header parsing

- **WHEN** an uploaded `.csv` starts with `question,answer` and holds 20 data rows
- **THEN** the job becomes `parsed` with `item_count: 20` and empty-answer rows are still created as `pending` items for human review

#### Scenario: XLSX worksheet parsing

- **WHEN** an uploaded `.xlsx` has a first worksheet whose header row is `question,answer` and holds 12 data rows
- **THEN** the job becomes `parsed` with `item_count: 12` and twelve `import_item` rows in `pending` status

#### Scenario: Job with zero parsed items

- **WHEN** an uploaded `.csv` holds only its header row
- **THEN** the job becomes `parsed` with `item_count: 0` and no item rows

#### Scenario: Unrecoverable parse failure

- **WHEN** an uploaded `.json` file does not contain an array of objects
- **THEN** the job becomes `failed`, stores a parse error message, and creates no items

#### Scenario: Conversation shape cleaned and paired

- **WHEN** an uploaded file is sniffed as a conversation shape (wecom archive or three-column table)
- **THEN** the job transitions through cleaning and pairing before `parsed`, and only paired items are stored

#### Scenario: Unpaired messages are not stored as items

- **WHEN** cleaning and pairing yields unpaired messages
- **THEN** those messages are recorded in the unpaired pool and create no import items

## ADDED Requirements

### Requirement: Import job stage counters

The system MUST expose per-job stage counters (`parsed`, `cleaned`, `paired`, `unpaired`, `pendingReview`, `approved`, `imported`, `failed`) on the job detail so operators can track pipeline progress.

#### Scenario: Detail shows stage counters

- **WHEN** an operator calls `GET /admin/import-jobs/:id` for a conversation-shaped job
- **THEN** the response includes the stage counters reflecting current progress
