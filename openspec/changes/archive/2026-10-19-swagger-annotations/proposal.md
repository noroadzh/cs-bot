# Proposal: swagger-annotations

## Why

admin/health/wecom 控制器已经挂上 `@nestjs/swagger`，但大部分 `@ApiResponse` 只有
`status + description`，没有 `type`。生成的 OpenAPI 文档里这些端点的 2xx 响应全是空
schema，前端/联调方看不到任何返回结构，文档等于没写。

## What Changes

1. **新建 Response DTO**（`@ApiProperty` 注解的 class），覆盖 admin + media 全部 2xx 返回：
   - `common/dto/license-state.dto.ts` — LicenseStateDto
   - `common/dto/usage.dto.ts` — UsageCountersDto / UsageSnapshotDto
   - `admin/dto/admin-responses.dto.ts` — ConfigCheck / ConfigReload / KeywordsReload /
     LicenseStatus / LicenseReload / MissRecord / MissRecords
   - `media/dto/asset-response.dto.ts` — Asset / AssetCreate / AssetList / AssetDelete
2. **控制器补 `type:`**：config / license / miss / asset 四个控制器的 `@ApiResponse`
   全部挂上 DTO；wecom callback 的 200 补 inline string schema（明文 echostr / 空 ack）。
3. **契约测试** `test/swagger-docs.spec.ts`：反射读取每个控制器 handler 的
   `@ApiOperation` / `@ApiResponse` 元数据，断言
   - 每个 handler 都有 `@ApiOperation`；
   - 每个 2xx 响应必须声明 `type`（DTO class）或 `schema`（inline）；
   - 被引用的 DTO 都带 `@ApiProperty` 元数据——防止后人新加端点又漏 type。

## Impact

- Affected specs: `specs/adapter/spec.md`（admin API 文档化要求）
- Affected code: `apps/adapter/src/common/dto/**`、`apps/adapter/src/admin/**`、
  `apps/adapter/src/media/**`、`apps/adapter/test/swagger-docs.spec.ts`
- 不改任何运行时行为，纯注解 + 类型声明。
