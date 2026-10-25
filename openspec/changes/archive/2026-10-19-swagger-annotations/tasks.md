# Tasks: swagger-annotations

## 1. 创建 Response DTO 类

- [x] 1.1 `apps/adapter/src/common/dto/license-state.dto.ts` — `LicenseStateDto`（含 7 个字段 `@ApiProperty`）
- [x] 1.2 `apps/adapter/src/common/dto/usage.dto.ts` — `UsageCountersDto` / `UsageSnapshotDto`
- [x] 1.3 `apps/adapter/src/common/dto/health-response.dto.ts` — `HealthResponseDto` / `HealthDegradedResponseDto`
- [x] 1.4 `apps/adapter/src/common/dto/error-response.dto.ts` — `ErrorResponseDto`
- [x] 1.5 `apps/adapter/src/admin/dto/admin-responses.dto.ts` — `ConfigCheckDto` / `ConfigReloadDto` / `KeywordsReloadDto` / `LicenseStatusDto extends LicenseStateDto` / `LicenseReloadDto extends LicenseStateDto` / `AdminUsageDto extends UsageSnapshotDto`
- [x] 1.6 `apps/adapter/src/admin/dto/miss-export.dto.ts` — `MissRecordDto` / `MissExportDto`
- [x] 1.7 `apps/adapter/src/media/dto/asset-response.dto.ts` — `AssetDto` / `AssetCreateResponseDto` / `AssetListResponseDto` / `AssetGetResponseDto` / `AssetDeleteResponseDto`

## 2. 控制器补 `type:` 注解

- [x] 2.1 `ConfigController` — `check` / `reload` / `reloadKeywords` 的 2xx 挂 DTO
- [x] 2.2 `LicenseController` — `status` / `reload` / `getUsage` 的 2xx 挂 DTO（继承自 `LicenseStateDto` / `UsageSnapshotDto`）
- [x] 2.3 `MissController` — `list` 的 200 挂 `MissExportDto`
- [x] 2.4 `AssetController` — `create` / `list` / `get` / `delete` 的 2xx 挂对应 DTO
- [x] 2.5 `WecomController.callback` — 200 补 inline `string` schema（明文 echostr / 空 ack）
- [x] 2.6 `HealthController.check` — 200 挂 `HealthResponseDto`，degraded 挂 `HealthDegradedResponseDto`

## 3. 契约测试

- [x] 3.1 新建 `apps/adapter/test/swagger-docs.spec.ts`：反射读 11 个 controller handler 的元数据
- [x] 3.2 断言 1：每个 handler 都有 `@ApiOperation`
- [x] 3.3 断言 2：每个 2xx `@ApiResponse` 必须声明 `type`（DTO class）或 `schema`（inline）
- [x] 3.4 断言 3：被引用的 DTO 的所有属性都带 `@ApiProperty`（防止空转 + 防后人漏注解）

## 4. 验证

- [x] 4.1 `npx jest test/swagger-docs.spec.ts` 通过 49 项断言
- [x] 4.2 `npx jest` 全量 36 suites / 355 tests 通过

## 5. Swagger UI 路由启用（后补）

- [x] 5.1 `main.ts` — `SWAGGER_ENABLED=true` 时挂 Swagger UI（`SwaggerModule.setup(SWAGGER_UI_PATH, ...)`，生产默认关）
- [x] 5.2 `main.ts` — 追加 `GET /docs/openapi.json` 裸 JSON 端点（避开 SwaggerModule.setup 占用的 `/docs-json`）
- [x] 5.3 `src/common/docs-paths.ts` — `SWAGGER_UI_PATH` / `OPENAPI_JSON_PATH` 常量独立成无副作用模块（main.ts 顶层有 bootstrap 副作用，契约测试无法 import）
- [x] 5.4 契约测试补 2 组挂载断言（路径正确 / 避开 `/docs-json` / 与 UI 同源）
