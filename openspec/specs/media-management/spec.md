# media-management Specification

## Purpose
提供素材（文档、链接、视频）的上传、存储、检索、删除与外发能力，使机器人能够按需将预置素材发送给群成员。

## Requirements

### Requirement: Asset upload

The system MUST provide `POST /admin/assets` that accepts a multipart upload (field `file`) or a JSON body with `{type, url, name}`. It MUST validate the file size against `MAX_ASSET_BYTES` (default 20MB), reject disallowed MIME types, and return the created asset's `id` and `type`. Each asset MUST be stored under `data/assets/<id>` with a record row persisted in the `asset` table.

#### Scenario: Successful file upload
- **WHEN** an operator posts a PDF file of 2MB to `POST /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 201 with `{id, type: "file", name, size}`, stores the bytes under `data/assets/<id>`, and inserts one row into the `asset` table

#### Scenario: Upload exceeds size limit
- **WHEN** an operator posts a file of 25MB while `MAX_ASSET_BYTES` is 20MB
- **THEN** the system returns HTTP 413 with an error code identifying the size limit and stores nothing

#### Scenario: Disallowed MIME type
- **WHEN** an operator posts a file whose MIME type is not in the allowed asset MIME list
- **THEN** the system returns HTTP 415 with an error code identifying the rejected type and stores nothing

#### Scenario: URL-only asset creation
- **WHEN** an operator posts JSON `{type: "link", url: "https://example.com/doc", name: "使用手册"}` without a file
- **THEN** the system returns HTTP 201 with `{id, type: "link"}` and inserts one row into the `asset` table without writing a file under `data/assets/`

### Requirement: Asset listing with pagination

The system MUST provide `GET /admin/assets` that returns assets ordered by `created_at` descending, accepting `limit` (default 50, max 200) and `offset` (default 0) query parameters, and returning `{total, limit, offset, rows}`.

#### Scenario: Default listing
- **WHEN** an operator calls `GET /admin/assets` with no query parameters on a database holding 3 assets
- **THEN** the system returns HTTP 200 with `total: 3`, `limit: 50`, `offset: 0`, and `rows` ordered newest-first

#### Scenario: limit is clamped to the maximum
- **WHEN** an operator calls `GET /admin/assets?limit=1000`
- **THEN** the system returns HTTP 200 with `limit: 200` and at most 200 rows

#### Scenario: Offset beyond the end
- **WHEN** an operator calls `GET /admin/assets?offset=500` on a database holding 3 assets
- **THEN** the system returns HTTP 200 with `rows: []` and the correct `total`

### Requirement: Asset deletion

The system MUST provide `DELETE /admin/assets/:id` that removes the `asset` table row and deletes the corresponding file under `data/assets/` when the asset is of type `file`. Deleting a non-existent `id` MUST return HTTP 404.

#### Scenario: Deleting a stored file asset
- **WHEN** an operator sends `DELETE /admin/assets/a1b2c3` for an existing file asset
- **THEN** the system returns HTTP 200, removes the row, and the file no longer exists under `data/assets/a1b2c3`

#### Scenario: Deleting a link asset
- **WHEN** an operator sends `DELETE /admin/assets/a1b2c3` for a link asset
- **THEN** the system returns HTTP 200 and removes the row without touching the filesystem

#### Scenario: Deleting an unknown id
- **WHEN** an operator sends `DELETE /admin/assets/nope`
- **THEN** the system returns HTTP 404 and no row is removed

### Requirement: Asset reference resolution

The system MUST resolve each `[[素材:<id>]]` reference found in an answer to the corresponding `asset` row before sending, and MUST skip (with a warning log) any reference whose `id` does not exist or whose type is not one of `link`, `file`, `video`.

#### Scenario: Known asset id resolves
- **WHEN** an answer contains `[[素材:a1b2c3]]` and row `a1b2c3` exists with type `link`
- **THEN** the system resolves the reference to that row and passes `type: "link"` and `url` to the asset sender

#### Scenario: Unknown asset id is skipped
- **WHEN** an answer contains `[[素材:missing]]` and no such row exists
- **THEN** the system logs a warning naming the id, omits the asset from the send queue, and still sends the remaining text reply

### Requirement: Asset send failure isolation

The system MUST treat an asset send failure as non-fatal to the message: the text reply and all other queued assets MUST still be delivered, and the failure MUST be logged with a machine-readable error code.

#### Scenario: Asset send rejects while text succeeds
- **WHEN** sending asset `a1b2c3` throws an error and the text reply succeeds
- **THEN** the system returns success for the overall message, logs the asset failure with its error code, and does not retry the asset

### Requirement: Asset upload file storage path isolation

The system MUST resolve every uploaded asset file under the `data/assets/` directory and MUST reject any uploaded filename whose resolved path would escape that directory.

#### Scenario: Path traversal filename is rejected
- **WHEN** an operator uploads a file named `../../etc/passwd`
- **THEN** the system returns HTTP 400 without writing any file outside `data/assets/`

#### Scenario: Normal filename is stored under a generated id
- **WHEN** an operator uploads a file named `报价单 v2.xlsx`
- **THEN** the system stores it under `data/assets/<generated-id>` and preserves the original name only as a `name` column value
