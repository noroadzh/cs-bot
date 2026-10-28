# Design

## Context

现行实现与规格的差距见 proposal.md。几个约束决定方案形态：

- 数据库迁移由 `docker-entrypoint-initdb.d` 按文件名顺序执行，新迁移必须接在 `013-import-message-stage.sql` 之后，并同时登记到 `deploy/docker-compose.yml` 与 `deploy/Dockerfile.adapter`（`scripts/check-migrations.sh` 校验）。
- `import_item.question` 当前为 `NOT NULL`，而“丢弃条目不留正文”要求置空，需要同步放宽约束。
- 导入解析在 HTTP 请求内同步执行，没有任务队列；引入后台队列超出本期范围。
- 基线 compose 只有 nginx 对外，但 Docker 网段是动态分配的，无法用固定 CIDR 表达“可信代理”。
- 监控模块已有 `remediate()` 骨架，但没有注入重启函数，也没有周期调度。

## Goals / Non-Goals

**Goals:**

- 用最小改动的数据模型补齐导入去重、统计与审核可追溯性，保持现有 API 契约不破坏。
- 注销流程可审计、可重试、可幂等，删除动作只在 T+7 由 sweep 执行。
- 管理面 IP 白名单在反代下既可正确识别客户端，又不能被伪造头绕过。
- 监控自愈可观测、有上限，不会因单实例故障拖垮控制面。

**Non-Goals:**

- 不引入任务队列或后台 worker；导入仍在请求内完成，只用租约保证互斥。
- 不改变现有导入任务状态词表（`uploaded/parsing/parsed/approved/partial/rejected/failed`），仅新增 `rolled_back`；设计文档按契约修订。
- 不实现外部告警通道（邮件/企微机器人）；告警落审计日志与结构化日志，通道由部署方接入。
- 不重写 `local-model-routing` 规格（见 proposal Out of Scope）。

## Decisions

### D1 注销：独立状态 + 计划删除时间 + 一次性令牌

新增 `tenant_offboarding` 表（`tenant_id` 主键、`confirm_token_hash`、`token_expires_at`、`approvals JSONB`、`scheduled_at`、`destroyed_at`、`confirmation` JSONB）。`export` 生成 32 字节随机令牌，仅返回一次，库内存 SHA-256；TTL 24 小时。`destroy` 校验两个不同审批人 + 令牌哈希/有效期/未使用，将 `tenant.status` 置 `offboarding`、`scheduled_at = now() + 7 days`，写审计 `tenant.destroy_scheduled`。已有 `offboarding` 记录时重复调用返回同一计划，不再校验令牌（幂等）。

删除由现有 sweep 扩展：到期租户依次 `down -v`、drop database、删除 `/data/tenants/<id>`、备份目录、证书与 `secrets.enc`，最后置 `terminated` 并写 `tenant_destroy_confirmation` 记录 + 审计 `tenant.destroyed`。每步幂等，失败保留 `offboarding` 下轮重试。

备选：复用 `terminate` 立即删除——被否，违反 PRD“确认收货后 7 天”的窗口。

### D2 导入去重：应用层规范化 + 唯一索引

`source_hash = sha256(NFKC(q).trim().collapse_spaces() + "\n" + NFKC(a).trim().collapse_spaces())`，保留大小写（中文与英文问句大小写可能有语义）。批内先用 `Set` 去重，再 `INSERT ... ON CONFLICT (source_hash) DO NOTHING`，以 `RETURNING` 行数差累加 `dedup`。直接配对格式的 `session_hash`/`occurred_at` 为空；会话格式取 `sha256(conversationId)` 前 32 位十六进制与消息原时间。

审核清单生成时间记录在 `import_job.manifest_generated_at`，超过 30 天返回 410（`IMPORT_MANIFEST_EXPIRED`）。

历史数据回填：迁移只加可空列与部分唯一索引（`WHERE source_hash IS NOT NULL`），启动后由一次性脚本分批回填；已清空正文的 rejected 条目无法回填，保持 NULL。备选“迁移期内建唯一索引”——被否，旧数据重复会导致迁移失败。

### D3 正文留存：拒绝即清空，修改即覆盖

`confirm()` 在同一事务里对 `review_status='rejected'` 的条目执行 `question=NULL, answer_raw=NULL, answer_redacted=NULL`；迁移 014 放宽 `question` 为可空。`modified` 条目用运营提交的 `answer`（可选 `question`）经同一脱敏器生成 `answer_redacted`，原文存 `answer_raw`，并重算 `source_hash`。数据集只写 `answer_redacted`。

备选“审核前不落正文”——被否，审核清单需要展示正文，改动过大。

### D4 导入互斥：数据库租约而非进程内锁

新增单行表 `import_lock(id=1, job_id, stage, heartbeat_at)`。获取用 `INSERT ... ON CONFLICT (id) DO UPDATE ... WHERE heartbeat_at < now() - interval '10 minutes' RETURNING job_id`；运行期每 30 秒心跳；结束时删除本 job 的锁行。抢锁失败返回 409 `{errCode:"IMPORT_BUSY", activeJobId}`。服务启动时清空残留锁（单实例部署前提），崩溃但未重启的场景由 10 分钟租约兜底，两种情况都不需要人工清库。

备选 PostgreSQL advisory lock——互斥更轻，但拿不到 activeJobId，且连接池复用下释放时机不易保证。备选 Redis 锁——多一个依赖，且崩溃后依赖 TTL 同样有窗口。

### D5 客户端 IP：集中解析 + 可信代理 CIDR

新增 `resolveClientIp(req)`：默认取 `req.socket.remoteAddress`；仅当该地址命中 `TRUSTED_PROXY_CIDRS` 时，取 `X-Forwarded-For` 中第一个非可信代理地址，否则回退 `X-Real-IP`。`AdminGuard` 与 HTTP 访问日志共用该函数。compose 为内部网络固定子网（如 `172.30.0.0/24`），`.env.template` 默认 `TRUSTED_PROXY_CIDRS=172.30.0.0/24`；nginx 统一补 `X-Forwarded-For`。

备选 Express `trust proxy`——全局隐式行为影响所有 `req.ip` 使用点，且默认 `true` 风险更高；集中函数更易测试。

### D6 监控自愈：调度在模块内，重启经 Provisioner

`PlatformModule` 构造 `PlatformMonitor(source, (id) => tenants.restart(id))`。`PlatformMonitor` 实现 `OnModuleInit`，按 `PLATFORM_MONITOR_INTERVAL_MS`（默认 60000）串行巡检（上一轮未结束则跳过），维护每租户连续失败计数与重启时间戳：连续失败 ≥ `PLATFORM_RESTART_FAILURE_THRESHOLD`（默认 2）才重启；每租户每小时最多 `PLATFORM_RESTART_MAX_PER_HOUR`（默认 3）次；超过则只告警。每次重启/告警写 `platform_audit_log`（`tenant.restart` / `tenant.alert`）并输出结构化日志；重启异常吞掉并计数，不中断巡检。

备选独立 cron/sidecar——增加部署面，本期不取。

### D7 非 root：镜像内固定 UID + 初始化脚本

运行时镜像沿用 distroless `nonroot`（uid/gid 65532），`/app/data`、`/app/logs`、`/app/license` 归其所有。compose 默认 `user: "${CSBOT_UID:-65532}:${CSBOT_GID:-65532}"`；宿主 bind mount 由新增 `deploy/init-perms.sh` 在首次部署时 `chown`（需 root），部署手册写明顺序。控制面同样以 65532 运行，并通过 `group_add: ${DOCKER_GID}` 访问 docker socket；socket 权限由部署手册要求 `chmod 660` 且组归属正确。


### D8 租户管理口：默认关闭，按 CIDR 放行

`TENANT_ADMIN_ALLOW_CIDRS` 为空时 `render()` 不生成 8443 server、不发布 `${port+1}`。非空时生成 server 并写入 `allow <cidr>; deny all;`。provision 结果与日志记录“admin console enabled/disabled + CIDRs”。备选仅绑定 `127.0.0.1`——被否，运营需要远程访问。

### D9 文档与契约：以 OpenSpec 规格为准

设计文档中的状态词表（`file_check/pairing/review/importing/done`）与平台路由（`POST quota`、`/platform/audit`）与已冻结契约冲突。本期修订设计文档到实现契约，并在文档中记录“状态机为管道内部阶段，对外仍用任务状态 + 阶段计数表达”，不再改 API。

## Risks / Trade-offs

- [令牌经 HTTP 返回后丢失] → 重新 export 生成新令牌并使旧令牌失效；文档说明一次性。
- [7 天窗口内实例仍在线，租户可能继续产生数据] → `offboarding` 状态禁止续费/变更，sweep 删除前重新快照导出并覆盖确认包。
- [source_hash 对短文本可被字典反推] → 仅对已脱敏文本计算；rejected 条目清空正文后哈希仍在，属可接受残留（设计明确保留）。
- [租约 10 分钟窗口内进程崩溃后无法立即重跑] → 心跳与日志暴露持锁 job；运维可用管理接口强制释放（任务中提供 `POST /admin/import-jobs/lock/release`）。
- [非 root 与既有宿主目录权限冲突] → `init-perms.sh` + 部署手册；升级脚本检测不可写时给出明确报错而非静默失败。
- [监控重启可能放大故障] → 阈值 + 每小时上限 + 退避；重启失败只告警。
- [固定 Docker 子网可能与宿主网络冲突] → 子网可配置，`.env.template` 标注冲突时的修改方法。

## Migration Plan

1. 迁移 `014-import-dedup-counters.sql`：加列、放宽 `question`、建部分唯一索引、建 `import_lock`。
2. 迁移 `015-tenant-offboarding.sql`：`tenant_offboarding` 表、注销确认表、状态检查约束加入 `offboarding`。
3. 部署顺序：先迁移（幂等）→ 发布新镜像 → 运行 `scripts/backfill-import-hashes.mjs` 分批回填 → 观察 `dedup`/`imported` 计数。
4. 回滚：镜像可回退到旧版本（新增列可空、唯一索引对旧写路径无影响）；`offboarding` 租户在回退前先用管理脚本取消计划（本期提供 SQL/脚本说明），避免旧版本 sweep 不认识该状态。

## Open Questions

- 告警外发通道（企微群机器人 / 邮件）由部署方在后续变更接入；本期只落审计与日志，不影响本变更的规格与任务拆分。

## Verification

执行记录（2026-10-28，本机 OrbStack）：

- 单测：`pnpm -C apps/adapter exec jest test --testPathIgnorePatterns='/integration/|/acceptance/' --runInBand --forceExit --testTimeout=60000` → 80 suites / 877 tests 通过（含镜像运行时测试）。
- 集成：`TEST_PG_URL=postgresql://cs:cs@127.0.0.1:55432/csbot_test pnpm -C apps/adapter exec jest test/integration --runInBand --forceExit` → 7 suites / 22 tests 通过（含租约并发、T+7 删除、修改后入库、失败计数、跨批去重、重复回滚）。
- 验收：`TEST_PG_URL=... bash scripts/acceptance.sh` → 6 suites / 23 tests 通过。
- 迁移：`bash scripts/check-migrations.sh` → 16 个迁移全部登记；`docker compose --env-file deploy/.env.template -f deploy/docker-compose.yml config -q` → exit 0。
- 镜像：`docker build -f deploy/Dockerfile.adapter -t cs-bot-adapter:verify .` 成功；容器内 `process.getuid()=65532`，`/app/data`、`/app/logs`、`/app/license` 可写；`/app/migrate` 含 015/016 新迁移。
- 验证修复：失败导入计数（try/finally 刷新）、manifest 30 天过期（`manifest_generated_at` + 410）、重启清理租约（`ImportLock.resetOnBoot`）、10 个场景测试补齐；`import-job.service.ts` 已拆分至 454 行，新增 `import-parse/create/review/confirm/query/dedupe/mappers/lock/manifest` 均 <500 行。
- 对抗性：`test/client-ip.spec.ts`（伪造 XFF 拒绝、可信代理解析）、`test/integration/import-pipeline-e2e.spec.ts`（并发导入 409、强制释放）、`test/tenant-offboarding.spec.ts`（T+7 前零删除、令牌复用拒绝）、`test/platform-monitor.spec.ts`（重启上限/告警去重）。
