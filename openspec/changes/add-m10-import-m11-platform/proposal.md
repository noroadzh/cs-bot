# Proposal: add-m10-import-m11-platform

## Why

MVP 数据面已跑通（wecom 回调 → QA → 用量统计），但运营闭环缺两块：**知识冷启动靠手工逐条录入**（无法批量导入历史 FAQ）和**交付形态是单实例部署**（无法以 SaaS 形式向多个客户交付、收取授权费）。M10（QA 批量导入 + 人工审核）解决前者，M11（多租户开通 + 配额 + 审计控制面）解决后者；两者共用 admin 控制面与 PG 基础设施，故合为一个 change 交付。

## What Changes

- **M10 知识导入**：
  - 新增 `import_job` / `import_item` 两张表与 `004-import-job.sql` 迁移
  - 支持从文件上传（multipart）或 URL 抓取创建导入 job，解析出 question/answer 对
  - 解析产物逐条脱敏（手机号/身份证/银行卡/邮箱/URL 五类正则），命中项强制人工复核
  - 逐条 / 批量审核流转， approved 条目进入 QA 检索语料
  - job 状态机：`uploaded → parsing → parsed → approved | partial | rejected | failed`
- **M11 多租户控制面**：
  - 新增 `tenant` / `tenant_quota` / `tenant_usage_daily` / `platform_audit_log` 四张表与 `007-tenant.sql` 迁移
  - 租户生命周期状态机：`created → provisioning → active → grace → paused → terminated`（含 `provisioning_failed`）
  - 实例编排走 **docker compose**：`Provisioner` 接口 + 默认 `ShellProvisioner`（spawn `docker compose up/down/stop/start`），接口可替换（二期接其他编排）
  - 配额模型：`max_chats` / `max_msgs_per_day` / `max_storage_mb` / `max_concurrent_qa`，按租户可独立设置
  - 日用量聚合表（tenant_id + day 唯一），供配额判断与账单导出
  - 平台操作审计：链式哈希（prev_hash → hash）防篡改追加日志
- **端点**：`/admin/import-jobs*` 8 个、`/platform/tenants*` 10 个 + `/platform/audit-log` 1 个，全部复用 Basic Auth + IP whitelist
- 不改动现有数据面请求路径（wecom → qa → reply）；不做计费集成、不做 K8s 编排、不做数据面多租户路由（R2.5）

## Capabilities

### New Capabilities

- `import-job`: 导入 job 的创建（文件/URL）、解析、状态机、列表、详情与删除；同源文件（sha256）重传短路
- `import-review`: 导入条目的五类敏感信息脱敏、逐条/批量审核流转、approved 条目进入 QA 语料的门槛
- `tenant-registry`: 租户元数据、生命周期状态机（provision/grace/suspend/resume/terminate/renew）、docker compose 编排的 Provisioner 接口与默认 Shell 实现
- `tenant-quota`: 租户配额设置与校验、日用量聚合、配额超限行为
- `platform-audit`: 平台控制面操作的链式哈希审计日志（append-only、可校验）

### Modified Capabilities

（无 — 现有 capability 的需求均不变；`admin-api` 的端点清单由新 capability 各自声明，不改其既有需求）

## Impact

- **代码**：`apps/adapter/src/import/`（新模块）、`apps/adapter/src/platform/`（新模块）、`apps/adapter/src/admin/admin.module.ts`（挂载 import 控制器）、`apps/adapter/src/app.module.ts`（注册两模块）
- **SQL**：`apps/adapter/src/import/004-import-job.sql`、`apps/adapter/src/platform/007-tenant.sql`（编号沿用 `media/002-asset.sql` 的追加式迁移惯例）
- **API**：新增 19 个管理端点；无既有端点破坏性变更
- **依赖**：不新增运行时依赖（multipart 用现有 multer，进程编排用 `node:child_process`，cron 用现有 `@nestjs/schedule`）；明确不引入 BullMQ/dockerode
- **配置**：新增 env（`IMPORT_MAX_FILE_BYTES`、`PLATFORM_COMPOSE_DIR` 等），进 `config.schema.ts` 并保持 fail-fast 风格
- **测试**：每个新 service/controller 配 spec，纳入现有 jest 套件
