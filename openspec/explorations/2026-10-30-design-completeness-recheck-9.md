# 概设/详设完整性复核（第九轮，2026-10-30，只读）

## 范围

基准：概设 V1.14、详设 V1.7。本轮核对**概设 §7 数据设计（平台侧表）**、**详设 §2.4 license-native**、**M11 开通流程与文档一致性**。

## 结论

M1–M11 功能无缺口，前八轮问题均已闭环。本轮发现 **1 项客户可见文档错误** 与 **3 处内部设计文档失真**，均为文档层，不改代码。

## P1 客户可见文档错误

### 部署手册附录 A 第 3 步要求的「租户管理页」不存在

- `docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md:586`：`3. 客户在租户管理页填入企微 Secret/Token/AESKey 与 LLM 配置（或使用平台代付额度）。`
- 实际：管理面为**纯 API**（概设 §3.4 明确「本期纯 API，不提供自研管理界面，可视化归二期」）；租户没有任何管理页面。密钥由我方运营通过 `PUT /platform/tenants/:id/secrets` 写入（`platform.controller.ts:139`），凭证经 `.../credentials/handoff` 一次性交接。
- 影响：客户按手册找不到入口，SaaS 开通无法完成。
- 建议：改为「客户通过约定安全渠道提供企微 Secret/Token/AESKey 与 LLM Key；平台运营经平台接口写入租户密钥库」；并注明管理页面属二期增项。

## P2 内部设计失真：概设 §7.4 平台侧表与实际迁移不符

| 表 | 文档（概设 §7.4） | 实际迁移 |
|---|---|---|
| `tenant` | `id varchar(16)`（T-0007）、`domain`、`instance_host/port_base`、`db_name`、`plan`、`sub_status/sub_start_at/sub_expire_at`、`license_fp`、`image_version` | `007-tenant.sql`：`id UUID`、`name varchar(255)`、`status`、`host`、`port`、`database_url`、`expired_at`、`last_provision_log`、`deleted_at`（+016 `credentials_handed_at`、017 `contact`）；无 domain/plan/sub_status/license_fp/image_version |
| `tenant_usage_daily` | `tenant_id + stat_date` 复合 PK、`msgs_in/qa_hit/...` | `id UUID` PK + `UNIQUE(tenant_id, day)`、`chat_count/api_call_count/storage_bytes/user_count`（016 增 capacity 列） |
| `platform_audit_log` | `id bigserial`、`action varchar(32)`、`reason varchar(200)`、`hash_prev` | `id UUID` + `seq BIGSERIAL`、`payload JSONB`、`prev_hash`、`hash`；无 `reason` 列（reason 在 payload 内） |
| `tenant_quota` | `max_chats/max_msgs_per_day` | 实际为 `max_chats/max_storage_mb/max_api_calls/max_users/max_llm_tokens_per_month/max_docs/max_qa/max_asset_mb` |

影响：内部工程/二期按概设建表会失败；排障查列名会查错。
建议：§7.4 按 `007/008/011/012/015/016/017` 迁移重写，并注明「以迁移为准」。

## P3 详设 §2.4 license-native 签名与实现不符

- 文档：`verify(...) -> Bool`、`antireplay(last_ts, now) -> Bool`、`selfcheck(js_ctx_hash) -> Bool`。
- 实际 `packages/license-native/index.d.ts`：`verify(payloadJson, sigB64): VerifyResult`、`antireplay(statePath, now): AntireplayResult`、`selfcheck(): SelfcheckResult`、`fingerprint(): string`。
- 建议：按 `.d.ts` 重写该节（含返回结构体字段）。

## P4 详设 §3.8 启动校验位置表述

- 文档写「启动强校验（main.ts，先于 HTTP listen）」；实际由 `AppModule.onModuleInit` 调用 `LicenseService.startupCheck()`（`app.module.ts:60`），发生在 `NestFactory.create` 期间、仍早于 `app.listen`。
- 效果一致，建议改为「AppModule.onModuleInit（Nest 初始化期，早于 HTTP listen）」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 开通编排步骤 | 端口段、独立库/网络/数据目录、证书、license、健康检查、失败回滚均实现 |
| 租户隔离与配额下发 | 独立 compose/网络/库；配额变更同步 `/internal/tenant/sync` |
| 订阅状态机与宽限 | `tenant-expiry-sweep` T-30/15/7 → grace → paused |
| 注销 | export → confirmToken → T+7 → destroyed |
| 平台鉴权 | Basic Auth + `PlatformReasonGuard` + destroy 双签/令牌 |
