# Proposal

## Why

对照《概要设计 V1.9》《详细设计 V1.1》逐模块核对后，仍有若干偏差：注销未按“导出 → 租户确认 → 7 天后删除”执行、导入“丢弃”条目正文仍落库、反代下管理面 IP 白名单失真——这三项直接触及合规与管理面可用性。另有导入去重/统计/审核可追溯性缺失、平台监控自动重启未接线、部署默认 root 等缺口。服务器无法 SSH，线上问题只能依赖日志与可审计数据定位，消除这些盲区应尽快完成。

## What Changes

- **注销流程**：`POST /platform/tenants/:id/destroy` 改为登记注销计划（要求一次性 `confirmToken` + 双签），实例与数据在 T+7 由定时任务删除，并写入删除确认单；新增注销状态与取消窗口。**BREAKING**：destroy 不再立即删除，响应改为返回计划删除时间。
- **导入合规**：按设计保留/丢弃策略处理正文——`rejected` 条目清空 `answer_raw`/`answer_redacted`，`modified` 条目保存修订后正文；审核清单的“会话哈希/发生时间”取真实值。
- **导入可追溯**：`import_item` 增加 `source_hash`（唯一）、`session_hash`、`occurred_at`；批次级/跨批次按 `source_hash` 去重；补齐 `masked/blocked/dedup/approved/imported/failed` 等阶段计数；回滚后任务状态标记 `rolled_back`。
- **导入并发**：同一时刻仅允许一个导入管线运行，第二个请求返回 `IMPORT_BUSY`（HTTP 409），保证 4C8G 下问答 SLA。
- **审核结论**：单条审核支持 `modified`（修改后保留），并记录修订内容与备注。
- **管理面安全**：仅在可信代理来源上采信 `X-Forwarded-For`/`X-Real-IP`，修复 Nginx 反代下白名单误拒或形同虚设的问题。
- **平台监控**：把自动重启注入 `PlatformMonitor`，增加周期巡检、重启退避与次数上限、告警审计，避免重启风暴。
- **部署基线**：adapter 默认以非 root UID 运行（镜像内预建用户、数据/日志目录授权）；租户 FastGPT 管理口默认关闭或限定来源网段。
- **文档对齐**：修订设计文档中与已冻结 API 契约不一致的任务状态词表与平台路由（以契约为准，不改 API）。

### Out of Scope

- `local-model-routing` 规格仍描述已被 FastGPT RAG 架构取代的“直连本地 LLM”路径，且 hybrid 健康探测滞回依赖其重写；该规格需单独变更，避免两套语义混杂。
- 控制面独立目录（`apps/control-plane`）、管理 UI、mTLS、5.4 真实多租户 UAT（环境受限）延续既有记录。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `import-job`：阶段计数集合扩展；新增单任务互斥要求。
- `import-pipeline`：条目级 `source_hash` 去重与会话元数据；审核清单取值修正；回滚状态。
- `import-review`：`modified` 审核结论与正文保留规则。
- `admin-api`：可信代理下的客户端 IP 解析与白名单判定。
- `tenant-registry`：注销生命周期（confirmToken、T+7、删除确认单、可取消）。
- `platform-monitoring`：周期巡检、自动重启接线、退避上限与告警。
- `deployment-suite`：adapter 非 root 运行。
- `tenant-provisioning`：租户 FastGPT 管理口访问限制。

## Impact

- **代码**：`apps/adapter/src/import/*`（entity、service、controller、迁移 SQL）、`apps/adapter/src/platform/*`（offboarding、controller、monitor、module）、`apps/adapter/src/admin/admin.guard.ts`、`apps/adapter/src/main.ts`、`deploy/docker-compose.yml`、`deploy/Dockerfile.adapter`、`deploy/nginx/nginx.conf`、`apps/adapter/src/platform/provisioner/shell-provisioner.ts`。
- **API**：`POST /platform/tenants/:id/destroy` 语义变更（breaking）；`PATCH /admin/import-jobs/:id/items/:itemId` 增加 `modified`；`GET /platform/tenants/:id` 与导入详情增加计数；其余路径不变。
- **数据**：新增迁移（`import_item` 三列与唯一索引、`import_job` 计数列、注销状态/确认单表）；旧数据回填 `source_hash`、`session_hash`、`occurred_at` 采用可空 + 渐进回填。
- **测试**：导入去重/计数/审核清单、注销状态机与定时删除、反代 IP 白名单、监控重启退避、非 root 运行、租户管理口暴露。
- **文档**：详设任务状态机与平台路由表、部署手册（非 root 与 8443）、操作手册（注销流程）。
