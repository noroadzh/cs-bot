# Tasks

## 1. Schema 与状态机

- [x] 1.1 追加式迁移 `apps/adapter/src/platform/008-control-plane.sql`：`tenant` 增 `tls_cert_ref`/`secrets_ref`；新增 `tenant_upgrade_batch`、`tenant_snapshot`、`tenant_offboarding` 表；幂等 DDL
- [x] 1.2 `TenantStateMachine` 增加 `trialing`/`suspended` 与概设转移，`paused` 映射 `suspended`；spec 覆盖合法/非法/兼容转移
- [x] 1.3 `config.schema.ts` 新增 `PLATFORM_MASTER_KEY`、`PLATFORM_TLS_PROVIDER`、`PLATFORM_UPGRADE_CANARY_ID`

## 2. 完整开通编排

- [x] 2.1 `ShellProvisioner` 扩展：独立 project/network、DB 名、Redis/Mongo、数据目录参数；spec 覆盖资源隔离
- [x] 2.2 `CertificateProvider` 接口 + 默认实现（ACME 或预置证书）+ fake（测试），签发失败触发回滚
- [x] 2.3 授权签发：provision 成功前调 M9 签发绑定指纹+订阅期的 license，写入租户并挂载
- [x] 2.4 `TenantSecretStore`（AES-256-GCM + 主密钥，600），密文 `.env.enc`，明文不落日志
- [x] 2.5 provision 失败回滚已创建资源并置 `provisioning_failed`；spec 覆盖 TLS 失败回滚

## 3. 订阅提醒与注销

- [x] 3.1 `ReminderScheduler`：T-30/15/7 邮件 + 运维群提醒，spec 覆盖三段
- [x] 3.2 `POST /platform/tenants/:id/export` 生成加密导出包（KB/assets/pg_dump/config），spec 覆盖产物
- [x] 3.3 `POST /platform/tenants/:id/destroy` 双签校验 + T+7 删除 + 删除确认单，spec 覆盖无第二签拒绝/双签执行

## 4. 灰度升级

- [x] 4.1 `UpgradeOrchestrator`：批次 ≤10%、金丝雀 1 实例 → 观察 24h → 全量；`POST /platform/upgrades`
- [x] 4.2 升级前 `pg_dump` + 目录快照；失败自动回滚到上一镜像 tag + 快照，记录审计
- [x] 4.3 spec 覆盖金丝雀先行、快照先于换镜像、失败回滚

## 5. 监控聚合

- [x] 5.1 `PlatformMonitor` 轮询各实例 `/healthz` + 指标，短缓存；`GET /platform/usage` 汇总租户数/资源水位/异常实例
- [x] 5.2 异常实例自动重启（provisioner.stop/start）+ 告警；spec 覆盖重启与告警

## 6. 配额深化

- [x] 6.1 配额新增 `maxLlmTokensPerMonth` 维度（schema + PATCH + entity）
- [x] 6.2 配额变更即时下发实例（或每日拉取），spec 覆盖即时生效

## 7. 端点与集成

- [x] 7.1 `platform.module.ts` 注册新 service；`platform.controller.ts` 挂载 `/upgrades`、`/usage`、`/export`、`/destroy`
- [x] 7.2 既有全套 jest 通过；新增 spec 覆盖开通/升级/监控/注销/配额

## 8. 端到端验证

- [x] 8.1 真实 PG + 假 docker/cert provider 跑通：create → provision（隔离资源+证书+授权）→ quota push → upgrade canary → 回滚 → export → destroy 双签 → verify
- [ ] 8.2 跨租户检索 0 命中抽测；`openspec validate complete-m11-control-plane --strict` 通过
