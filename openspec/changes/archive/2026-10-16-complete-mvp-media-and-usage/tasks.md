# Tasks

## 1. Database Schema & Migration

- [x] 1.1 Create `apps/adapter/src/media/002-asset.sql` with `asset` table schema (id uuid, type enum, name text, url text, size int, created_at timestamptz)
- [x] 1.2 Update `Dockerfile.adapter` to COPY the new SQL file to `/app/migrate/`
- [x] 1.3 Add table creation to deployment verification: `psql -f /app/migrate/002-asset.sql` (verify table exists)

## 2. Media Management - Storage Service

- [x] 2.1 Create `apps/adapter/src/media/asset.entity.ts` with Asset interface (id, type, name, url, size, createdAt)
- [x] 2.2 Create `apps/adapter/src/media/asset.service.ts` with:
  - `createFromFile(buffer, originalName, mimeType)` → Asset
  - `createFromLink(url, name)` → Asset
  - `findById(id)` → Asset | null
  - `findAll(limit, offset)` → {total, rows}
  - `delete(id)` → boolean
  - `resolvePath(id)` → string (data/assets/<id>)
- [x] 2.3 Implement path traversal prevention: use random UUID for file id, never use user-provided filename as path component
- [x] 2.4 Add file size validation: reject > MAX_ASSET_BYTES (default 20MB)
- [x] 2.5 Add MIME type whitelist validation: reject disallowed types with HTTP 415

## 3. Media Management - Admin Endpoints

- [x] 3.1 Create `apps/adapter/src/media/asset.controller.ts` with:
  - `POST /admin/assets` (multipart file or JSON body)
  - `GET /admin/assets` (pagination: limit, offset)
  - `DELETE /admin/assets/:id`
- [x] 3.2 Add Basic Auth + IP whitelist guard to controller (reuse existing `AdminGuard`)
- [x] 3.3 Wire controller into `MediaModule` and import in `AppModule`
- [x] 3.4 Write unit tests: `asset.controller.spec.ts` (upload, list, delete, error cases)

## 4. Media Management - Asset Reference Resolution

- [x] 4.1 Create `apps/adapter/src/media/asset-reference.resolver.ts` with:
  - `parseReferences(text)` → string[] (extract [[素材:<id>]] patterns)
  - `resolveReference(id)` → Asset | null
- [x] 4.2 Update `qa-orchestrator.service.ts` to:
  - Parse asset references from answer text
  - Cap at 2 references per answer (drop extras silently)
  - Call AssetService to resolve ids before sending
  - Log warning for unknown/missing ids
- [x] 4.3 Write integration test: asset reference round-trip (mock answer with [[素材:xxx]] → verify asset sent)

## 5. Media Recognition - Service

- [x] 5.1 Create `apps/adapter/src/media/media-recognize.service.ts` with:
  - `recognizeImage(mediaId): Promise<string>` (calls qwen-vl API)
  - `recognizeImageFromUrl(url): Promise<string>`
  - `isSupportedMediaType(mimeType): boolean`
- [x] 5.2 Add mock mode: when `USE_MOCK_LLM=true`, return predefined description
- [x] 5.3 Add timeout handling: reject after LLM_TIMEOUT_MS, return empty string on timeout
- [x] 5.4 Add error handling: non-2xx response returns empty string, logs error

## 6. Media Recognition - Integration

- [x] 6.1 Update `wecom.controller.ts` to:
  - Detect image attachments in incoming message
  - Call MediaRecognizeService before routing
  - Inject recognized text as prefix: `【图片识别】<desc> <original-question>`
- [x] 6.2 Add truncation: limit recognized text to 500 chars, append "..." if exceeded
- [x] 6.3 Write integration test: image message → recognition → enriched question → keyword trigger

## 7. Usage Reporting - Service

- [x] 7.1 Create `apps/adapter/src/usage/usage.service.ts` with:
  - In-memory counters: messagesReceived, messagesAnswered, messagesRefused, messagesMissed, assetsSent, tokensPrimary, tokensFallback
  - `increment(key)` method
  - `getUsage(period)` → UsageSnapshot
  - Period types: daily, weekly, monthly
  - Auto-reset counters on period change
- [x] 7.2 Add token estimation: `Math.ceil(text.length / 2)` per LLM call
- [x] 7.3 Create `apps/adapter/src/usage/usage-snapshot.ts` with file I/O for persistence
- [x] 7.4 Add 60-second timer: write snapshot to `data/usage-snapshot.json`
- [x] 7.5 Add startup restore: read snapshot, if period matches restore counters, else discard

## 8. Usage Reporting - Admin Endpoint

- [x] 8.1 Add `GET /admin/usage` to `admin.controller.ts` with:
  - Query param: `period` (daily|weekly|monthly, default daily)
  - Response: {period, startedAt, counters, generatedAt}
- [x] 8.2 Protect with AdminGuard (Basic Auth + IP whitelist)
- [x] 8.3 Write unit tests: counter increment, period reset, snapshot round-trip

## 9. Usage Reporting - Webhook

- [x] 9.1 Add `UsageWebhookService` with:
  - `report()` method: POST JSON to USAGE_WEBHOOK_URL
  - Timeout: 10 seconds hard limit
  - Non-2xx response: log error, do not throw
- [x] 9.2 Add cron job: every USAGE_REPORT_INTERVAL_MS (default 24h) call `report()`
- [x] 9.3 Add startup log: if USAGE_WEBHOOK_URL empty, log "usage webhook disabled"

## 10. Usage Reporting - License Status Integration

- [x] 10.1 Update `GET /admin/license` response to include `currentUsage` field
- [x] 10.2 Include: messagesReceived, assetsSent for current daily period

## 11. Configuration Updates

- [x] 11.1 Add to `packages/shared/src/env-schemas.ts`:
  - `QWEN_VL_BASE_URL`: EnvString.url() (default empty for mock)
  - `QWEN_VL_API_KEY`: EnvString.min(8) (default empty for mock)
  - `MAX_ASSET_BYTES`: EnvInt(20971520) (20MB)
  - `USAGE_WEBHOOK_URL`: EnvString.optional().default('')
  - `USAGE_REPORT_INTERVAL_MS`: EnvInt(86400000) (24h)
  - `USAGE_PERIOD`: EnvString.default('daily')
- [x] 11.2 Ensure all new config vars have valid defaults for mock mode
- [x] 11.3 Update `.env.template` with new variables and descriptions

## 12. Integration & End-to-End

- [x] 12.1 Update `qa-orchestrator.service.ts` to increment usage counters:
  - After LLM call: increment tokensPrimary or tokensFallback
  - After successful answer: increment messagesAnswered
  - After refusal: increment messagesRefused
  - After miss recorded: increment messagesMissed
  - After asset sent: increment assetsSent
- [x] 12.2 Update `wecom.controller.ts` to increment messagesReceived on every valid incoming message
- [x] 12.3 Run full test suite: `pnpm -C apps/adapter test`
- [x] 12.4 Run coverage check: `pnpm -C apps/adapter test:cov` (ensure no regression)

## 13. Documentation

- [x] 13.1 Update `docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md`:
  - Document new /admin/assets endpoints
  - Document new /admin/usage endpoint
  - Document new environment variables
- [x] 13.2 Add API spec: swagger annotations for new endpoints

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Verify the archived result: `openspec archive complete-mvp-media-and-usage`