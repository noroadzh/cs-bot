# Design

## Context

见 proposal.md 与 `openspec/explorations/2026-10-28-design-completeness-recheck.md`。约束：4C8G 单机、群聊只能用 appchat 主动发送、控制面与租户实例物理隔离、敏感信息不得入日志、导入不能挤占问答资源。

## Goals / Non-Goals

**Goals:**

- 补全 P0/P1 缺口，使注销导出、续期授权、图片链路、导入合规达到设计口径。
- 用最小 API 变更完成 P2 的契约与运维收口。
- 保持现有已冻结路径（`/admin/import-jobs`、`/platform/*`）和状态词表不变。

**Non-Goals:**

- 不改群聊被动回复（平台不支持）、不做管理 UI/mTLS、不拆 `apps/control-plane`。
- 不引入 Kafka/独立 worker 集群；导入与图片仍用进程内后台任务。

## Decisions

### D1 租户导出包：真实数据 + 流式加密

新增 `TenantExportService`：
- 知识库：对该租户 FastGPT MongoDB 执行 `mongodump --archive --gzip`，完整导出文档与向量数据（避免依赖不同 FastGPT 版本的导出接口）；
- assets：读取租户资产目录/对象存储，保留文件字节；
- pg_dump：用租户 `database_url` 执行 `pg_dump`（或 `docker compose exec pg pg_dump`），失败即整体失败；
- config：租户配置（不含密钥明文，密钥只带 key 名与加密引用）。

导出包写入 `data/exports/<id>/export-<ts>.enc`（租户目录之外，T+7 删除不波及），打包为 tar 后用租户密钥加密，输出 0600。大租户分卷/流式写，避免整包入内存。备选“仅导出配置 + 提示人工备份”被否，不满足合规交付。

### D2 续期：先签新 license，再更新订阅

`renew` 顺序：校验状态/天数 → 生成新到期时间 → 调用 `licenseIssuer.issue`（绑定 fingerprint、新到期）→ 更新 `expired_at`/状态 → `tenantSync.sync`（实例拉取新 license 或重启 adapter）。license 签发失败则不更新订阅并返回 5xx。审计 payload 增加 `licenseIssued: true`。

备选“只更新订阅，等实例到期再说”被否，会导致续费不生效。

### D3 控制面暴露与备份

- compose 删除控制面默认 `ports`；仅当 `CONTROL_PLANE_BIND` 非空且非 `0.0.0.0` 时渲染端口映射。文档给出 SSH 隧道/管理网段两种访问方式。
- `backup.sh` 增加 `pg_dump -d ${CONTROL_PLANE_DB:-csbot_control}`，失败视为整体失败；备份清单写 manifest。

### D4 图片识别异步化

回调解析出 image 后立即 `res.send(200)`，把 `{chatId,userId,mediaId,traceId}` 投递到进程内 `ImageTaskQueue`（有界、去重 msgId、并发受 `VL_CONCURRENCY` 限制）。worker：下载媒体 → 按响应头 MIME 识别 → 结果非空且非 `[NO_TEXT]` 时注入 QA 链路；否则发引导话术。任务失败只发引导，不影响回调。识别请求 10s 超时，模型取 `QWEN_VL_MODEL`，提示词固定为“提取图片中与咨询/操作相关的文字，归纳为一句中文问题；无有效内容时仅返回 [NO_TEXT]”。

备选“在回调内 await”被否：企微 5s 无 ack 会重试，且会放大重复识别。

### D5 导入后台任务

`POST /admin/import-jobs/:id/parse` 只做状态校验 + 获取租约 + 投递任务，返回 202；任务在进程内串行执行（复用 `ImportLock`），状态/计数写入 `import_job`，客户端轮询详情。进程重启时把 `parsing` 任务标记 `failed`（`parse_error='interrupted by restart'`），允许 retry；源文件保留到任务终态后清理。

备选“独立 worker 容器”被否：4C8G 基线不增加常驻进程，且导入是低频管理操作。

### D6 导入合规

- 源文件写盘 `mode: 0o600`。
- 脱敏新增 `ADDRESS`（省市区+街道门牌模式）与 `NAME`（姓氏+1~2 字，需词典/上下文避免误伤）两类；名称识别保守，命中写入 flags 并强制人工复核。
- FastGPT dataset 客户端：`ensureDataset`/`writeBatch` 3 次指数退避（1s/2s/4s），仅对 5xx/网络错误重试；4xx 不重试。
- `import_job` 新增 `dataset_id`（持久化 FastGPT collection id）；rollback 用 `dataset_id` 删除，缺失时按 `历史语料-{jobId}` 名称兜底。
- `failJob` 调用 `cleanupSource`。

### D7 凭证一次性交接

`TenantSecretsService.handoff(tenantId)` 读取生成类密钥中的 `ADMIN_PASSWORD`/`FASTGPT_ROOT_PASSWORD`，只在 provision 响应（或 `POST /platform/tenants/:id/credentials/handoff`）返回一次；不写日志/审计 payload，不提供再次读取。实现上不额外落明文文件，读取自 `secrets.enc` 后只存在响应体；记录 `handoff_at` 防止重复展示（第二次返回 410，除非显式 rotate）。

### D8 未配对补配

新增：
- `GET /admin/import-jobs/:id/unpaired` 分页列出未配对消息；
- `POST /admin/import-jobs/:id/unpaired/pair` body `{customerMessageId, serviceMessageId, question?, answer?}`，事务内创建 `pending` item、删除两条 pool 记录、重算计数。
补配项进入同一审核清单，仍受脱敏/黑名单/去重约束。

### D9 过滤、上下文与契约

- 敏感词命中：整段替换固定话术，日志只记 `hitCount`/`chatHash`/`userHash`。
- 上下文：读取 `CONTEXT_ROUNDS`（默认 5），按轮存储；保留 TTL 滑动。
- 未命中导出：支持 `from`/`to`（ISO 日期）；`days` 继续兼容。
- 拒答默认文案改为设计文本，可通过 `REFUSAL_TEXT` 覆盖。
- 触发配置兼容 `triggers.prefixes` 与现有 `keywords`，统一构建前缀 trie。

### D10 配额、用量、审计、升级、告警

- `tenant_quota` 增加 `max_docs/max_qa/max_asset_mb`；`tenant_usage_daily` 增加 `doc_count/qa_count/asset_mb`；适配层上报时从 FastGPT/资产目录采集计数。
- 审计：所有平台变更请求 DTO 增加必填 `reason`；动作表增加 `shell_access`（如有运维 shell 入口）。
- 升级：`PLATFORM_UPGRADE_WINDOW` 默认 `02:00-04:00`；`PLATFORM_UPGRADE_NOTICE_DAYS=3`，由调度器提前通知；紧急覆盖需 `force=true` 并写审计。
- 到期提醒：保留 webhook，新增 SMTP/邮件 Notifier；T-30/15/7 双通道发送。
- 审计留存：保留本地 180 天清理，新增 `scripts/export-audit.mjs` 供部署方在清理前导出异地留存。
- 日配额：保留达到上限拒绝消息的现有实现，修订概设描述以消除“已服务群不受影响”的歧义。
- 群上限拒绝：`LicensedChatService` 在拒绝时调用运维告警（Redis 去重 24h）。

### D11 local-model-routing 规格收敛

规格改为“所有模式走 FastGPT RAG，MODEL_MODE 只决定模型通道与云回退策略”；hybrid 增加 30s FastGPT 健康探测、失败回落与 5 分钟恢复滞回；local 禁止云出口。删除对 `LOCAL_LLM_BASE_URL` 直连的旧描述，配置仍保留兼容但不再作为主路径。

## Risks / Trade-offs

- [导出大租户内存/磁盘压力] → 流式打包、分卷、导出前检查磁盘余量；失败保留临时目录供重试。
- [续期签 license 失败造成订阅已改] → 先签发后更新；失败不落库。
- [异步图片任务丢失] → 队列有界 + 失败降级话术；回调已 ack，不阻塞企微。
- [姓名脱敏误伤] → 保守词典 + 强制人工复核，不做全局泛化匹配。
- [FastGPT 导出接口版本差异] → 适配器探测能力，缺失时回退到数据集 API 分页导出。
- [后台导入崩溃] → 启动把 parsing 置 failed，允许 retry；租约启动清理。

## Migration Plan

1. 迁移 016：`import_job.dataset_id`、`tenant_quota` 新维度、`tenant_usage_daily` 容量字段、审计 reason（payload 内，无需列）。
2. 先发布控制面（导出/续期/审计/备份），再发布数据面（图片异步、导入后台、配额上报）。
3. 回滚：新增列可空/有默认；关闭异步开关 `IMPORT_ASYNC=false` 可回到请求内解析；导出/续期回滚不影响既有租户。
4. 文档同步：部署手册（控制面绑定、备份、升级窗口）、操作手册（凭证交接、未配对补配、导出包校验）。

## Verification

- 单测/集成覆盖导出包内容、续期 license、图片异步 ack、导入 202/失败清理、脱敏七类、dataset 重试/重启回滚、凭证一次性、补配、过滤整段替换、上下文轮数、from/to、配额维度、审计 reason、升级窗口、群上限告警、hybrid 滞回。
- 验收：真实 PG + 假 docker；导出包解密后校验 KB/assets/dump 存在。

## Verification（实施后）

- 单测：93 suites / 919 tests 通过。
- 集成：7 suites / 27 tests 通过（含导出包、续期 license、图片异步 ack、导入 202/0600/清理、未配对补配、重启回滚、控制面 reason）。
- 验收：6 suites / 23 tests 通过。
- 迁移：17 个迁移；`016-runtime-gaps.sql` 在空库/存量库幂等。
- 镜像：重新构建成功；非 root 65532、目录可写、UID 覆盖、镜像内包含 `017-runtime-gaps.sql`。
- 文档：部署手册补充控制面端口/备份/导出包/凭证交接/导入图片/审计/升级/本地模型说明。
