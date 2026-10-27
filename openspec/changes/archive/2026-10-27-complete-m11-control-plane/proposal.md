# Proposal: complete-m11-control-plane

## Why

M11（增项 C）当前实现为控制面骨架：租户注册表、docker compose 编排、配额/用量、链式审计、到期扫描。概设 §5 M11 的 SaaS 运营能力仍缺失——TLS 签发、独立 DB/Redis/Mongo 资源初始化、租户密钥库、订阅提醒、批量灰度升级、监控聚合、双签注销与数据导出。当前形态不足以承载真实多租户交付。

## What Changes

- **完整开通编排**：分配资源槽位 → 渲染 compose/env（独立端口段、DB `tenant_{id}`、独立 Redis/Mongo、数据目录 `/data/tenants/{id}/`）→ 初始化 schema/管理员口令 → 申请 TLS → 签发订阅期授权证书 → 启动 + 健康检查 → 注册表 `active`；任一步失败回滚并置 `failed`。
- **租户密钥库**：每租户独立 .env 加密存储（AES-256 + 主密钥，600）。
- **订阅提醒**：T-30/15/7 天邮件 + 运维群提醒。
- **批量升级与灰度**：`POST /platform/upgrades`——镜像版本矩阵、每批 ≤10%、金丝雀 1 实例 → 观察 24h → 全量；升级前自动快照，失败自动回滚。
- **监控聚合与平台总览**：`GET /platform/usage` 聚合各实例 healthz/问答失败率/LLM 失败率/资源水位；异常实例自动重启并告警。
- **双签注销与导出**：`POST /platform/tenants/:id/export`（知识库+assets+pg_dump+config 加密包）、`/destroy`（双签 → T+7 删除实例/数据/备份/证书 → 删除确认单 → 注册表 terminated）。
- **状态机对齐概设**：`trialing → active → grace → suspended → terminated`（兼容现有 `created/provisioning/paused` 迁移映射）。
- **配额深化**：配额变更即时下发实例；新增 LLM token 月度上限维度。

## Capabilities

### New Capabilities
- `tenant-provisioning`: 完整开通编排（独立资源/TLS/授权签发/回滚）与租户密钥库。
- `tenant-upgrade`: 批量升级、灰度、快照与自动回滚。
- `platform-monitoring`: 实例指标聚合、平台总览、异常告警与自动重启。

### Modified Capabilities
- `tenant-registry`: 状态机对齐概设、订阅提醒、双签注销/导出/删除流程。
- `tenant-quota`: 配额即时下发、LLM token 月度上限。

## Impact

- **代码**：`apps/adapter/src/platform/`（provisioner 扩展、upgrade、monitoring、offboarding、secrets）、`apps/adapter/src/admin/`（邮件/告警）。
- **API**：新增 `/platform/upgrades`、`/platform/usage`、`/platform/tenants/:id/export|destroy`；`/platform/tenants/:id/quota` 语义对齐。
- **SQL**：`tenant` 增加 `tls_cert_ref`、`secrets_ref`、`state` 扩展；新增升级批次/快照/注销单表或字段。
- **依赖**：TLS 签发通道、邮件服务、对象存储/独立实例编排参数、KMS 或主密钥文件。
- **风险**：跨租户隔离验收（跨租户检索 0 命中）；升级回滚与快照的正确性；范围大，建议按阶段验收。

## 备注

- 概设 §5 M11、§7.4 平台表、详设 §3.10；总纲见 `close-overview-design-gaps`。
- 本 change 只做 M11 运营能力，不含 M10/增项 D/验收测试。
