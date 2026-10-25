# Tasks

## 1. Schema 迁移

- [x] 1.1 写 `apps/adapter/src/import/004-import-job.sql`（import_job + import_item 两表、索引、状态 CHECK 约束），并验证迁移加载器按序执行成功（`SELECT` 可查到新表）
- [x] 1.2 写 `apps/adapter/src/platform/007-tenant.sql`（tenant / tenant_quota / tenant_usage_daily / platform_audit_log 四表、唯一键、索引、status CHECK），并验证迁移执行成功
- [x] 1.3 补 `config.schema.ts` 新 env（`IMPORT_MAX_FILE_BYTES`、`IMPORT_MAX_FILE_BYTES__URL`、`PLATFORM_COMPOSE_DIR`、`PLATFORM_PROVISION_TIMEOUT__MS`、`PLATFORM_ENABLED`），fail-fast 校验，跑 `config.schema` 相关既有 spec 确认不回归

## 2. M10 数据与服务层

- [x] 2.1 建 `apps/adapter/src/import/import.module.ts` + `import-job.entity.ts` + `import-item.entity.ts`（TypeORM 实体对齐 1.1 的表结构），单测断言实体字段/表名
- [x] 2.2 实现 `SensitiveRedactor`（手机号/身份证/银行卡/邮箱/URL 五类正则，`<PHONE:n>` 等占位符替换，命中 flag 写入），spec 覆盖每类命中、混合文本、`MOCK_REDACTION` 关闭分支
- [x] 2.3 实现 `ImportParser` + 4 个 parser（CSV/JSONL/TXT/XLSX，MIME 字典映射，列名约束），spec 覆盖各格式正常/缺列/坏行、未知 MIME 返回 unsupported_format
- [x] 2.4 实现 `ImportJobService.createFromFile`（multipart 落盘 → sha256 → 重传短路 → 建 job+items → 状态 parsing→parsed）、`createFromUrl`（抓取同链路），spec 覆盖成功/超限/同源短路/抓取失败→failed
- [x] 2.5 实现 job 查询（列表分页+status 过滤、详情）与删除（级联删 items，待审也可删），spec 覆盖分页、过滤、删除后 items 一并消失

## 3. M10 审核流

- [x] 3.1 实现 `ImportReviewService`：逐条 PATCH（review_status 三态 + reviewer_note）、approve-all 批量、job 终态聚合（approved/partial/rejected），spec 覆盖三态流转、非法状态 409、approve-all 幂等
- [x] 3.2 实现 approved 条目进入 QA 语料的写入（复用现有 QA 检索数据源），spec 断言 approved 后可检索、pending/rejected 不可检索
- [x] 3.3 实现 `ImportController` 8 个端点挂 AdminGuard，supertest 级 spec 覆盖鉴权 401、415、413（超 IMPORT_MAX_FILE_BYTES）、happy path

## 4. M11 租户注册与编排

- [x] 4.1 建 `apps/adapter/src/platform/` 模块骨架：`tenant.entity.ts` + `tenant-quota.entity.ts` + `tenant-usage-daily.entity.ts` + `platform-audit-log.entity.ts`，单测断言对齐 1.2 表结构
- [x] 4.2 实现 `TenantStateMachine.assertTransition` 转移表（design D2），spec 覆盖全部合法/非法转移
- [x] 4.3 实现 `TenantProvisioner` 接口 + `ShellProvisioner`（render/up/probe/stop/start/down，spawn 数组传参，60s 命令超时，compose 项目名 `csbot-t-<id>`），spec 用假 docker 可执行文件覆盖命令拼装、超时、非零退出
- [x] 4.4 实现 `TenantService`：create（建行+默认配额+审计 tenant.create）→ provision（状态机+Provisioner.up+probe+写回 host/port+审计 tenant.provision；probe 超时→down+provisioning_failed），spec 覆盖成功/失败回滚/非法转移 409
- [x] 4.5 实现 renew / suspend / resume / terminate（terminate 走 down + DROP DATABASE + 审计含 droppedDatabase），spec 覆盖各自状态机约束与审计 payload

## 5. M11 配额与用量

- [x] 5.1 实现 `TenantQuotaService.setQuota`（PATCH 4 个限值 + 审计 before/after）与 `consume`（原子 `UPDATE ... WHERE count+Δ<=limit RETURNING`，0 行区分 429/404），spec 用真 PG 覆盖并发竞争（3 并发仅 1 成功）与超限语义
- [x] 5.2 实现 `TenantUsageService` 日聚合 upsert（ON CONFLICT DO UPDATE）与 `GET usage?from=&to=` 区间查询，spec 覆盖跨天、同天累加、区间边界
- [x] 5.3 实现 `TenantExpirySweep` cron：active→grace（到期前 7 天）、grace→paused（到期未续）、paused→terminated（暂停 30 天），每次转移写审计（tenant.expired-sweep / tenant.paused-sweep），spec 用假时钟覆盖三段转移与幂等

## 6. M11 审计链

- [x] 6.1 实现 `PlatformAuditService.append`（事务内 `FOR UPDATE` 取 prev_hash、sha256 链、INSERT；audit 失败不回滚业务但 error 日志），spec 覆盖首条 prev_hash=""、链式衔接、并发不分叉、audit 失败业务仍成功
- [x] 6.2 实现 `GET /platform/audit-log`（分页+tenant_id/action/from/to 过滤，hash 字段恒在）与 `GET /platform/audit-log/verify`（全链重算，返回 valid/brokenAtId），spec 覆盖过滤、篡改 payload 检出、删中间行检出

## 7. 端点挂载与集成验证

- [x] 7.1 `admin.module.ts` 挂 import 控制器、`app.module.ts` 注册 ImportModule + PlatformModule，`PLATFORM_ENABLED=false` 时 platform 路由整体关闭；既有全套 jest 通过
- [x] 7.2 端到端演练：真实 PG + 假 docker 跑通 创建租户→provision→设配额→超限 429→suspend→resume→terminate→审计 verify=true 全链路；真实 docker compose 单租户 provision 一次冒烟
- [x] 7.3 更新 `docs/03-交付实施/部署手册` 增补新 env 与 003/004 迁移说明；`openspec validate add-m10-import-m11-platform --strict` 通过
