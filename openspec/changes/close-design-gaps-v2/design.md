# Design

## Context

当前实现与概设/详设的差距已在 proposal 中列出。约束：不改变已冻结的管理面 API；私有化与 SaaS 共用同一代码基；`MODEL_MODE=cloud` 的现有行为必须保持不变；新增数据库列必须可空或有默认值，保证存量数据兼容；本机无外网/不能连远程，真实 6 容器与生产验证仍为可选。

## Goals / Non-Goals

**Goals:**
- 让已经写入 spec 但运行时未生效的能力真正接线（模型三档、提醒、Trie、覆盖门禁）。
- 修复会导致新部署不可用的硬缺口（迁移遗漏）。
- 补齐 PRD 明确要求但缺失的行为（多媒体引导、问题归一化、来源引用、配额预警）。
- 保持测试可本地执行：外部适配器默认可用 fake，但生产配置必须显式选择真实实现。

**Non-Goals:**
- 不重写控制面为独立 `apps/control-plane` 服务（保留 adapter 内 `/platform/*`，用 `PLATFORM_ENABLED` 隔离）。
- 不引入新基础设施（K8s、消息队列）。
- 不改变 API 路径与请求/响应字段（只做向后兼容的新增）。
- 不做二期功能（多模型路由策略、知识库前端）。

## Decisions

### D1: 模型路由接线（增项 D）
- 在 `QaModule` 增加 `MODEL_ROUTER` provider：`MODEL_MODE=cloud` → `null`；`local|hybrid` → `new ModelRouter(mode, localProvider, cloudProvider)`，provider 由 `LOCAL_LLM_BASE_URL/LOCAL_LLM_MODEL/LLM_*` 构造（OpenAI 兼容 `/v1/chat/completions`）。
- `QaModule.onModuleInit` 调用 `QaOrchestrator.setModelRouter(...)`。
- `config.schema.ts` 用 `superRefine`：`local|hybrid` 时 `LOCAL_LLM_BASE_URL` 必填且为 URL，否则启动失败并打印变量名。
- 备选：让 `IQA_ENGINE` 工厂直接返回路由器包装。放弃原因：会改变既有 FastGPT 引擎语义与测试桩，影响面更大。

### D2: 部署迁移完整性
- 以 `src/**/NNN-*.sql` 为唯一事实来源；compose 的 `docker-entrypoint-initdb.d` 与 Dockerfile 的 `/app/migrate` 覆盖全部 9 个文件（新增 `import/007`、`platform/008`）。
- 新增 `scripts/check-migrations.sh` 与 `test/deploy-migrations.spec.ts`：扫描 deploy 配置中的文件名集合，与源码集合比对，缺失即失败。
- 保留 initdb 机制（不改启动流程）；无需引入迁移框架。

### D3: 入站多媒体引导
- `WecomController` 在授权闸门之后、routing 之前增加分支：`MsgType ∈ {voice,video,file} && mentioned` → 发送固定引导话术并 `MissService.record({ mediaType })`，随后 200 ack。
- 未 @ 的多媒体仍由 TriggerService 静默（现状正确）。
- 新增 `009-miss-media-status.sql`：`media_type VARCHAR(16)`、`status SMALLINT NOT NULL DEFAULT 0`；导出 JSON/xlsx 追加字段。

### D4: 问答文本与质量
- 新增纯函数 `normalizeQuestion(raw, prefixes)`：去除首部 `@<bot>`/`@昵称` 与命中触发词前缀，压缩空白。
- `QaOrchestrator.handle` 在调用引擎前执行守卫：空/纯标点/长度 > 500 → 直接回引导话术，不调模型、不落 miss。
- 引擎返回结构统一为 `{ answer, quotes[], score }`；`FastGPTQaEngine` 解析 `responseData[].quoteList`（兼容现有 `data[].score`），orchestrator 追加 ≤2 条 `—— 来源：《…》`。
- 主通道失败重试 1 次（1s 退避）后再走 fallback 通道。

### D5: M11 真实适配器选择
- 配置驱动：`CERT_PROVIDER=fake|file|acme`、`LICENSE_ISSUER=noop|shell`、`PLATFORM_HEALTH_URL_TEMPLATE`、`PLATFORM_UPGRADE_CMD`。
- 生产默认：`file`（读取已签发证书路径）与 `shell`（调用签发 CLI）；`fake/noop` 仅允许 `NODE_ENV!=production`，生产启动时拒绝。
- `PlatformMonitor` 用 HTTP 探测各实例 `/healthz`；`UpgradeOrchestrator` 依赖 docker 命令（快照/切镜像/健康/回滚）；`TenantOffboarding` 用 `ExportPackager` 生成加密包并调用 provisioner 删除。
- 配额 80% 预警：`TenantQuotaService` 在 consume 后计算比例，Redis/内存按「租户+维度+自然日」去重，调用 Notifier。
- 订阅提醒：`TenantExpirySweepService` 每日 09:00 调用 `SubscriptionReminder`（邮件/群 webhook 由 Notifier 实现）。
- D10：控制面新增 `POST /platform/report`（计数器体），adapter 定时上报并保留 7 天重试缓冲。

### D6: 交付加固
- `javascript-obfuscator` 加入 devDependency 与 `obfuscate` 脚本；Dockerfile 启用该步骤。
- `nest-cli/tsconfig` 生产构建关闭 sourceMap；镜像构建后删除 `*.map`；去掉 `--enable-source-maps`。
- 新增 `scripts/release-sums.sh` 生成 `SHA256SUMS`（镜像 digest + 交付包）。

### D7: 导入与素材运维项
- `IMPORT_MAX_FILE_BYTES` 默认 200MB；解析前检查 5 万条上限；超限返回业务错误。
- 新增 `@Cron('40 3 * * *')`：清理 >30 天 review.xlsx、>180 天 import_item 元数据。
- 解析循环每批 2000 条检查 `process.memoryUsage().rss`，>80% 时 sleep/暂停并在恢复后继续。
- 素材：按类型限制（file 20MB / video 10MB），上传计算 md5 并复用已有记录，`writeFile(..., { mode: 0o600 })`。

### D8: 路由与保护
- `ALLOWED_CHAT_IDS`（逗号分隔，空=不限制）在 routing 入口判断。
- 限流反馈：群超限静默 + 5 分钟一次提示；单人超限回话术（复用 WeComClient）。
- Redis 异常时 dedup 使用进程内 Map（msgId→expireAt，容量上限 + 定期清理）。
- `HttpClient` 轻量信号量（llm=4/wecom=8/vl=2，可配置），FIFO 队列，超时放弃。
- 关键词改 Trie 前缀匹配，reload 原子替换引用。

### D9: 日志 PII 脱敏
- 在 `AppLogger` 的序列化入口对白名单字段（question/answer/content/text/reply）应用 `maskPII(text)`；不再额外记录正文。
- 保留现有 pino `redact`（密钥/authorization）作为第二道防线。

### D10: 验收补齐
- `load.spec.ts` 增加 `SUSTAINED_LOAD=1` 才执行的分支：50 并发 10 分钟，统计发送/应答计数差（无丢失）与 P95，报告落 `artifacts/acceptance/`。
- 新增导入吞吐测试：生成 1 万条 fixture，调用 `ImportJobService` 解析+配对，断言 ≤10 分钟并出报告。

## Risks / Trade-offs

- [真实适配器依赖外部环境] → 配置驱动 + 启动校验；fake 仅限非生产，CI 继续用 fake 覆盖逻辑。
- [混淆增加构建时间/包体] → 仅在 release 构建启用，开发与 CI 单测不受影响。
- [PII 正则误伤] → 沿用导入脱敏的保守规则；只作用于日志白名单字段。
- [50 并发 10 分钟耗时] → 默认跳过，nightly/手动开启，避免拖慢日常 CI。
- [D10 上报增加耦合] → 失败只缓冲不阻塞问答；控制面不可达不影响数据面。

## Known Limitations (2026-10-27)

- 真实 6 容器 compose 冒烟与生产验证仍受网络/服务器可达性约束，仅在 `REAL_COMPOSE=1` 或 nightly 执行。
- M11 真实适配器依赖外部 TLS 证书、签发私钥、docker/health 端点；CI 逻辑测试仍使用 fake/noop。
- 控制面仍运行在 adapter 内（`PLATFORM_ENABLED` 开关），未拆分为独立 `apps/control-plane`（本变更非目标）。
- 关键词热加载与提问归一化各自读取 `keywords.yml`，文件被外部修改时缓存按 mtime 刷新（秒级）。
- JS 混淆步骤已写入 Dockerfile/`obfuscate` 脚本，但本机无外网无法执行 `javascript-obfuscator`；该验证留待 CI/release 构建（任务 8.5 保持未完成）。
