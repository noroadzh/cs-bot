## MODIFIED Requirements

### Requirement: Asset upload

The system MUST provide `POST /admin/assets` that accepts a multipart upload (field `file`) or a JSON body with `{type, url, name}`. It MUST validate the file size against `MAX_ASSET_BYTES` (default 20MB), reject disallowed MIME types, and return the created asset's `id` and `type`. Each uploaded file MUST be stored under `data/assets/<id>.<ext>` (the extension derived from the MIME type) with a record row persisted in the `asset` table whose `url` is `/assets/<id>.<ext>`.

#### Scenario: Successful file upload
- **WHEN** an operator posts a PDF file of 2MB to `POST /admin/assets` with valid Basic Auth
- **THEN** the system returns HTTP 201 with `{id, type: "file", name, size}`, stores the bytes under `data/assets/<id>.pdf`, persists `url` as `/assets/<id>.pdf`, and inserts one row into the `asset` table

#### Scenario: Upload exceeds size limit
- **WHEN** an operator posts a file of 25MB while `MAX_ASSET_BYTES` is 20MB
- **THEN** the system returns HTTP 413 with an error code identifying the size limit and stores nothing

#### Scenario: Disallowed MIME type
- **WHEN** an operator posts a file whose MIME type is not in the allowed asset MIME list
- **THEN** the system returns HTTP 415 with an error code identifying the rejected type and stores nothing

#### Scenario: URL-only asset creation
- **WHEN** an operator posts JSON `{type: "link", url: "https://example.com/doc", name: "使用手册"}` without a file
- **THEN** the system returns HTTP 201 with `{id, type: "link"}` and inserts one row into the `asset` table without writing a file under `data/assets/`

### Requirement: Asset deletion

The system MUST provide `DELETE /admin/assets/:id` that removes the `asset` table row and deletes the corresponding file under `data/assets/` whenever the asset is of type `file` or `video`. Deleting a `link` asset MUST leave the filesystem untouched, and deleting a non-existent `id` MUST return HTTP 404.

#### Scenario: Deleting a stored file asset
- **WHEN** an operator sends `DELETE /admin/assets/a1b2c3` for an existing file asset
- **THEN** the system returns HTTP 200, removes the row, and the file no longer exists under `data/assets/`

#### Scenario: Deleting a stored video asset
- **WHEN** an operator sends `DELETE /admin/assets/a1b2c3` for an existing video asset
- **THEN** the system returns HTTP 200, removes the row, and the video file no longer exists under `data/assets/`

#### Scenario: Deleting a link asset
- **WHEN** an operator sends `DELETE /admin/assets/a1b2c3` for a link asset
- **THEN** the system returns HTTP 200 and removes the row without touching the filesystem

#### Scenario: Deleting an unknown id
- **WHEN** an operator sends `DELETE /admin/assets/nope`
- **THEN** the system returns HTTP 404 and no row is removed

### Requirement: Asset reference resolution

The system MUST resolve each `[[素材:<id>]]` reference found in an answer to the corresponding `asset` row before sending. The sender MUST receive the asset's `type`, its `name`, and, for `link` assets, its `url`; for `file` and `video` assets it MUST receive the absolute path of the stored file under `data/assets/`. References whose `id` does not exist or whose type is not one of `link`, `file`, `video` MUST be skipped with a warning log naming the id.

#### Scenario: Known asset id resolves
- **WHEN** an answer contains `[[素材:a1b2c3]]` and row `a1b2c3` exists with type `link`
- **THEN** the system resolves the reference and passes `type: "link"`, `name`, and `url` to the asset sender

#### Scenario: File asset resolves to a filesystem path
- **WHEN** an answer contains `[[素材:a1b2c3]]` and row `a1b2c3` exists with type `file` and `url: "/assets/a1b2c3.pdf"`
- **THEN** the asset sender receives `type: "file"` and the absolute path `data/assets/a1b2c3.pdf`

#### Scenario: Unknown asset id is skipped
- **WHEN** an answer contains `[[素材:missing]]` and no such row exists
- **THEN** the system logs a warning naming the id, omits the asset from the send queue, and still sends the remaining text reply

## ADDED Requirements

### Requirement: Asset send failure notification

When any asset of a reply fails to send, the system MUST send one degradation notice to the conversation after the text reply, MUST NOT retry that asset, MUST continue delivering the remaining assets, and MUST log the failure with a machine-readable error code.

#### Scenario: Failed asset is announced once
- **WHEN** a reply carries two assets and both sends throw
- **THEN** the text reply is delivered, the remaining asset is still attempted, exactly one degradation notice is sent to the conversation, and each failure is logged with `ASSET_SEND_FAIL`

#### Scenario: Successful send is not announced
- **WHEN** every asset of a reply sends successfully
- **THEN** no degradation notice is sent
