# Design: complete-m11-control-plane

## Context

M11 已交付控制面骨架（`TenantService` + `ShellProvisioner` + `TenantQuotaService` + `TenantUsageService` + `PlatformAuditService` + `TenantExpirySweep`）。本 change 补齐概设 §5 M11 的 SaaS 运营能力：完整开通（独立资源/TLS/授权）、密钥库、订阅提醒、灰度升级、监控聚合、双签注销，并对齐订阅状态机。

## Goals / Non-Goals

**Goals:**
- 每个租户物理隔离（独立 DB/Redis/Mongo/目录/网络）、可授权、可导出、可安全注销。
- 版本可灰度升级，失败可回滚。
- 平台单视图掌握所有实例健康度。

**Non-Goals:**
- 不做跨租户数据聚合（只存元数据/计数）。
- 不做计费集成（Stripe/支付宝）。
- 不做控制面高可用集群（单实例 + 备份）。

## Decisions

### D1: 资源隔离
每租户独立 compose project `csbot-t-<id>` + 独立 network；DB `tenant_<id>`；独立 Redis/Mongo 实例；数据目录 `/data/tenants/<id>/`。`ShellProvisioner` 扩展 render/up 接受资源参数。**抽测口径**：逻辑层在本地起两个独立 PG database，各写 `approved_qa`，断言 A 检索不到 B（可落地）；真实多实例抽测需 CI/有网环境，无网时跳过。

### D2: TLS 签发通道
抽象 `CertificateProvider` 接口：默认 `LetsEncryptDnsProvider`（通配域+SNI）或 `FileProvider`（预置证书）；测试注入 fake。签发失败即 provision 失败并回滚。

### D3: 授权签发
provision 成功前调用 M9 签发接口，生成绑定实例指纹 + 订阅期的 `license.lic`，写入租户记录并挂载到实例。

### D4: 密钥库
`TenantSecretStore`：AES-256-GCM，主密钥来自 `PLATFORM_MASTER_KEY`（文件 600 或 KMS）；每租户密文存 `data/tenants/<id>/.env.enc`；明文只在渲染实例 env 时短暂存在，不落日志。

### D5: 状态机映射
概设 `trialing → active → grace → suspended → terminated`；保留 `created/provisioning/provisioning_failed` 开通态；`paused` 视为 `suspended` 别名。`TenantStateMachine` 增加新状态与转移，旧数据平滑映射。

### D6: 升级灰度
`UpgradeOrchestrator`：批次 ≤10%、金丝雀 1 实例 → 观察 24h（错误率/延迟阈值）→ 全量；每租户升级前 `pg_dump` + 目录快照；失败自动回滚到上一镜像 tag + 快照。

### D7: 监控聚合
`PlatformMonitor` 定时轮询各实例 `/healthz` 与指标端点，写内存/短缓存；`GET /platform/usage` 汇总；异常实例触发 `upgrade/restart`（复用 provisioner.stop/start）并告警。

### D8: 注销双签
`Offboarding`：`export` 生成加密包（KB + assets + pg_dump + config）；`destroy` 需双签记录 → T+7 执行删除（实例/数据/备份/证书）→ 删除确认单 → 注册表 `terminated`（保留最小元数据）。

### D9: 订阅提醒
`ReminderScheduler` 每日扫描到期日，T-30/15/7 发邮件 + 运维群 webhook；与 `TenantExpirySweep` 协同（提醒不改变状态）。

## Risks / Trade-offs

- [R1 跨租户隔离] → 独立实例/网络 + 逻辑层独立 DB 抽测（本地可做）；真实多实例抽测归 CI。
- [R2 TLS 依赖] → 抽象 Provider，测试用 fake；生产需 DNS/ACME 配置。
- [R3 升级回滚正确性] → 快照 + 镜像 tag 双保险；回滚演练纳入验收。
- [R4 密钥管理] → 主密钥丢失即不可解密；主密钥备份责任前置。
- [R5 状态机迁移] → 旧 `paused` 映射 `suspended`，灰度期双向兼容。

## Migration Plan

1. **Schema**: `tenant` 增 `tls_cert_ref`、`secrets_ref`、`state` 扩展、`expires_at` 已有；新增 `tenant_upgrade_batch`、`tenant_snapshot`、`tenant_offboarding` 表（或字段）。
2. **配置**: `PLATFORM_MASTER_KEY`、`PLATFORM_TLS_PROVIDER`、`PLATFORM_UPGRADE_CANARY_ID` 等。
3. **代码**: provisioner 扩展、cert provider、secret store、upgrade orchestrator、monitor、offboarding、reminder。
4. **回滚**: feature flag 关闭新端点；DB 迁移不回退；旧 `paused` 继续可用。

## Open Questions

- TLS 方案（ACME DNS vs 预置证书）由运维环境决定。
- 升级观察窗口阈值（错误率/延迟）需与 SLO 对齐。
