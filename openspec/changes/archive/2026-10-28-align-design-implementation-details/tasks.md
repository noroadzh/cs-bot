# Tasks

## 1. 管理面可信代理（P0）

- [x] 1.1 新增 `apps/adapter/src/common/client-ip.ts` 的 `resolveClientIp()`，按 `TRUSTED_PROXY_CIDRS` 决定是否采信 `X-Forwarded-For`/`X-Real-IP`，并在 `ConfigService`/schema 增加该配置（默认回环）；验证：`test/client-ip.spec.ts` 覆盖可信代理、不可信伪造头、IPv6 回环、多级 XFF。
- [x] 1.2 让 `AdminGuard` 与 `http-logging.middleware` 统一使用 `resolveClientIp()`；验证：`test/admin-guard.spec.ts` 新增“nginx 反代 + 白名单客户端放行”“直连伪造 XFF 拒绝”两例。
- [x] 1.3 基线 `deploy/docker-compose.yml` 为内部网络固定子网并在 `.env.template` 增加 `TRUSTED_PROXY_CIDRS`，`deploy/nginx/nginx.conf` 补 `X-Forwarded-For`；验证：`docker compose config` 通过且模板变量出现在渲染结果中。

## 2. 租户注销流程（P0）

- [x] 2.1 新增迁移 `apps/adapter/src/platform/015-tenant-offboarding.sql`：`tenant_offboarding`、`tenant_destroy_confirmation` 表，`tenant` 状态约束加入 `offboarding`，并登记到 compose/Dockerfile 的 initdb 与 control 迁移挂载；验证：`scripts/check-migrations.sh` 通过，空库初始化后两表存在。
- [x] 2.2 扩展 `TenantOffboarding`：export 生成一次性 `confirmToken`（库内存哈希、24h TTL）并写 `tenant.export` 审计；destroy 校验两个不同审批人 + 令牌，置 `offboarding` 与 `scheduled_at=now+7d`，重复调用返回同一计划；验证：`test/tenant-offboarding.spec.ts` 覆盖缺令牌、单审批、重复调用、令牌复用拒绝。
- [x] 2.3 扩展 sweep：到期租户执行 `down -v`、drop DB、删除数据/备份/证书/密钥，置 `terminated` 并写确认记录与 `tenant.destroyed` 审计；每步幂等，失败保留 `offboarding`；验证：`test/platform-ops.spec.ts` 用 fake provisioner 断言 T+7 前零删除、T+7 后全删除且二次 sweep 无副作用。
- [x] 2.4 状态机禁止 `offboarding` 租户 renew/suspend/resume/provision，并在 `platform.controller.ts` 返回 409；验证：`test/tenant-state-machine.spec.ts` 新增 offboarding 四例。

## 3. 导入数据模型、去重与合规（P0/P1）

- [x] 3.1 新增迁移 `apps/adapter/src/import/014-import-dedup-counters.sql`：`import_item.source_hash/session_hash/occurred_at`、放宽 `question` 可空、部分唯一索引 `(source_hash)`、`import_job` 统计列、`import_lock` 单行表；验证：迁移在空库与既有库各执行一次均成功且可重复执行。
- [x] 3.2 解析时计算并写入 `source_hash`（NFKC/trim/空白折叠/换行连接）、`session_hash`、`occurred_at`，批内去重与 `ON CONFLICT DO NOTHING` 跨批去重并累加 `dedup`；验证：`test/import-streaming.spec.ts` 与新增 `test/import-dedup.spec.ts` 覆盖同批重复、跨批重复、直接配对格式空元数据。
- [x] 3.3 各阶段写入 `totalMessages/parsedMessages/masked/blocked/approved/imported/failed` 计数并让 `GET /admin/import-jobs/:id` 返回；验证：`test/import-job.spec.ts` 断言计数随阶段变化、失败后保留、回滚后 `imported=0`。
- [x] 3.4 审核清单改用条目自身 `session_hash`/`occurred_at`，缺失渲染 `—`；验证：`test/import-review-manifest.spec.ts` 断言同一 job 两会话哈希不同、时间为原对话时间。
- [x] 3.5 `confirm()` 对 rejected 清空 `question/answer_raw/answer_redacted`（保留 `source_hash`），对 modified 写入修订后正文并重算哈希；验证：`test/import-review.spec.ts` 覆盖“丢弃后正文为 NULL”“修改后入库用修订文本”。
- [x] 3.6 单条审核支持 `review_status=modified`（必填修订 answer，缺省 400），并把 modified 计为可入库；验证：`test/import-review.spec.ts` 新增 modified 成功、缺 answer 400、job 状态 recompute。
- [x] 3.7 提供 `scripts/backfill-import-hashes.mjs` 分批回填历史 `source_hash`（正文为空的 rejected 跳过），并在部署手册记录执行顺序；验证：脚本在种子数据上运行后 `SELECT count(*) WHERE source_hash IS NULL` 仅剩已清空正文条目。

## 4. 导入互斥与回滚（P1）

- [x] 4.1 实现租约辅助模块（获取/心跳/释放/过期回收），parse 与 confirm 入口统一获取，冲突返回 409 `IMPORT_BUSY` 与 `activeJobId`；验证：`test/import-lock.spec.ts` 覆盖并发 parse、并发 confirm、心跳续期、过期接管。
- [x] 4.2 提供 `POST /admin/import-jobs/lock/release`（Basic Auth）供崩溃后强制释放，并写结构化日志；验证：`test/import-lock.spec.ts` 断言释放后新任务可获取，路由不被 `:id` 吞掉。
- [x] 4.3 回滚后任务置 `rolled_back`、`imported_qa_id` 清空、`imported=0`，重复回滚无副作用；验证：`test/import-pipeline.spec.ts` 新增 rolled_back 与二次回滚两例。

## 5. 平台监控自愈（P1）

- [x] 5.1 `PlatformModule` 注入 `TenantService.restart`，`PlatformMonitor` 实现周期巡检（`PLATFORM_MONITOR_INTERVAL_MS`，默认 60000，串行防重入）；验证：`test/platform-monitor.spec.ts` 用 fake timers 断言按间隔巡检且不重入。
- [x] 5.2 连续失败阈值、每小时重启上限与退避生效，重启失败不中断巡检；验证：`test/platform-monitor.spec.ts` 覆盖单次抖动不重启、连续失败重启、超限只告警、restart 抛错后继续。
- [x] 5.3 重启与告警写 `platform_audit_log`（`tenant.restart`/`tenant.alert`）并输出结构化日志，未配置 restart 时只采集与告警；验证：`test/platform-monitor.spec.ts` 断言审计条目与无 restart 分支。

## 6. 部署基线（P2）

- [x] 6.1 `deploy/Dockerfile.adapter` 创建 UID/GID 65532 用户并授权 `/app/data`、`/app/logs`、`/app/license`；compose 默认 `CSBOT_UID/CSBOT_GID=65532`，控制面通过 `group_add` 访问 docker socket；验证：`docker run --rm --entrypoint id cs-bot-adapter:<tag>` 输出 uid=65532，容器内写三个目录成功。
- [x] 6.2 新增 `deploy/init-perms.sh` 在首次部署/升级时校正宿主目录归属，部署手册记录执行顺序与失败提示；验证：脚本在临时目录上执行后 `stat -c %u` 为 65532。
- [x] 6.3 `ShellProvisioner` 默认不渲染/不发布租户 8443，`TENANT_ADMIN_ALLOW_CIDRS` 非空时生成 `allow/deny` 并在 provision 报告与日志标注；验证：`test/shell-provisioner.spec.ts` 断言默认无 8443、非空时渲染 allow 规则与报告字段。

## 7. 文档与契约（P1）

- [x] 7.1 修订 `docs/02-需求与设计/详细设计-微信群智能客服机器人MVP.md` 的任务状态机与平台路由表，使其与冻结契约一致，并注明“内部阶段用计数器表达”；验证：文档中不再出现与 `platform.controller.ts` 冲突的路径/状态词表。
- [x] 7.2 更新部署手册（非 root、`init-perms.sh`、`TRUSTED_PROXY_CIDRS`、租户管理口）与操作手册（注销 export → token → T+7）；验证：按文档命令在 mock 环境可执行，路径与变量名与代码一致。

## 8. 集成验证

- [x] 8.1 全量单测与集成：`pnpm -C apps/adapter test -- --runInBand` 与 `test/integration/*` 全绿，覆盖新增模块。
- [x] 8.2 验收与迁移：`bash scripts/acceptance.sh`、`scripts/check-migrations.sh`、`docker compose -f deploy/docker-compose.yml config` 全部通过。
- [x] 8.3 对抗性验证：并发 parse 仅一个成功、反代伪造头被拒、T+7 前无删除、非 root 容器可写；记录命令与输出到变更说明。

## 9. 验证发现修复（W1–W4 + SUGGESTION）

- [x] 9.1 失败导入也刷新阶段计数：`runConfirm` 写入循环放入 try/finally，`failJob` 同步刷新；验证：新增 e2e 让第二批写入失败，断言 approved=120/imported=50/failed=70。
- [x] 9.2 实现 review.xlsx 30 天过期：`import_job.manifest_generated_at` 列 + 过期返回 410；验证：生成后把时间改为 40 天前，再次请求得到 410。
- [x] 9.3 重启后立即恢复租约：服务启动时清理 `import_lock` 单行；验证：插入锁行后调用 `onModuleInit`，下一次 parse 成功。
- [x] 9.4 补齐验证报告列出的 10 个测试场景（锁失败释放、入库互斥、重复回滚、跨批去重、modified 缺答案 400、rolled_back 保持、令牌跨租户复用、offboarding 禁止续费、镜像可写、UID 覆盖）。
- [x] 9.5 按建议拆分：新增 `import-lock.ts`、`import-manifest.ts`、`import-dedupe.ts`（持久化/去重/计数）与 `import-mappers.ts`，`ImportJobService` 仅做编排与委托；验证：相关单测与 e2e 全绿，新增文件均 <500 行。
- [x] 9.6 复跑全量单测、集成、验收与镜像验证，更新 design.md 的 Verification 记录。

## Workflow follow-up

- 完成后运行 `/opsx:verify`，按报告修复后再 `/opsx:archive`。
- 归档时同步主规格，并复跑一次迁移与 compose 校验。
