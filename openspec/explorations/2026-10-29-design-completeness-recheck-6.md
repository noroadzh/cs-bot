# 概设/详设完整性复核（第六轮，2026-10-29，只读）

## 范围

基准：概设 V1.11（§3 架构、§11 非功能）、详设 V1.4（§2 公共组件、§4 DDL、§5–§9）。本轮重点核对**架构约束 R-1~R-8 与非功能降级承诺**的实际落地，而不只是功能接口。

## 结论

**功能条目仍全部实现，无新增缺失。** 但发现 **1 项约束未兑现（R-2）** 与 **2 项降级/守护承诺与实现不符**，另有 1 项文档表述需澄清。

## 需处理

### 1. R-2「单一 FastGPT 客户端」未兑现

- 概设 §3.4 R-2：M4 与 M10 必须经同一个 `FastGPTClient` 封装调用，理由「统一超时、重试与鉴权」。
- 实际存在 4 处独立 FastGPT 访问：
  - `apps/adapter/src/qa/fastgpt-qa.engine.ts:24/35`（问答主/备实例）
  - `apps/adapter/src/import/fastgpt-dataset.client.ts:36`（数据集写入）
  - `apps/adapter/src/import/near-duplicate.ts:35`（检索测试）
  - `apps/adapter/src/usage/capacity-usage.service.ts:55`（collection 计数，直接拼 `FASTGPT_BASE_URL`）
- 影响：鉴权头、超时、重试策略分散 4 处，Key 轮换或 FastGPT 版本适配需改 4 个文件；R-2 的设计收益未获得。
- 建议：抽出 `FastGPTClient`（含 `chat/dataset/searchTest/collectionCount` 四类调用），各调用方改为注入；或修订 R-2 为「单一凭据来源 + 统一超时常量」并同步文档。**推荐前者**（R-2 是明确的架构约束）。

### 2. 「双通道挂 → 繁忙话术 + 告警」中的告警未实现

- 概设 §11.2 降级矩阵：双通道（DeepSeek + 通义 / 主备）都失败时应「繁忙话术 + 告警」。
- 实际：`qa-orchestrator.ts:88-95` 只回 `SLOW_REPLY_TEXT` 并 `increment('llmFailures')`；`llmFailures` 仅进 `/healthz` 与用量快照（`health.controller.ts:42`、`platform-monitor.ts:224`），**无主动告警**（无 webhook 推送、无节流告警）。
- 对比：license 有 `license-alert.service.ts` 主动推送；LLM 双通道全挂没有对应通道。
- 建议：复用 license 告警模式，对 `llmFailures` 连续超阈值（如 5 分钟内 ≥3 次）触发一次 webhook 告警并节流。

### 3. 「适配层挂 → systemd 重启（RTO < 1min）」与交付形态不符

- 概设 §11.2 与 §11.4、ADR A6 均写 systemd 拉起 compose。
- 实际交付：`deploy/docker-compose.yml` 全部服务 `restart: unless-stopped`，仓库无 `*.service` 单元文件；部署手册也未提供 systemd 步骤。
- 判断：`restart: unless-stopped` 已能覆盖「进程崩溃自愈」，RTO 秒级优于 1 分钟；但文档写 systemd 会误导运维去找单元文件。
- 建议：文档改为「容器 `restart: unless-stopped` 自愈；宿主重启后由 Docker 守护进程拉起（`systemctl enable docker`）」，删除 systemd 单元承诺；若确需开机自启编排，再补 unit 模板。

### 4. R-3「出站必经过滤」覆盖不全（文档需澄清）

- R-3 要求所有发往群内的文本（含素材标题、话术）必须过 M6。
- 实际过滤点只有 `qa-orchestrator.ts:112`（答案正文）。**未过滤**：授权/租户闸门话术（`wecom.controller.ts:140-142`）、多媒体引导话术（`:169`）、链接素材标题（`wecom-client.ts:193`）。
- 判断：这些是**系统内置固定话术**，不含用户输入，不会引入违规内容；素材链接标题来自管理员配置而非群消息。
- 建议：R-3 表述改为「所有**含动态内容**的发往群内文本必须过 M6；系统内置固定话术与管理员配置的素材标题除外」，并在设计中说明理由。**不建议给固定话术加过滤**（无收益、增加链路）。

## 已确认无问题的项

| 约束/承诺 | 结论 |
|---|---|
| R-1 单一企微出口 | 仅 `wecom-client.ts:26` 访问 qyapi，M8 经 WecomClient |
| R-4 授权前置 | `wecom.controller.ts` 入口闸门 + 缓存，受限不触达 M3–M6 |
| R-5 配置统一 | 全部经 `ConfigService`，密钥仅 env |
| R-6 文件分区 | `data/assets`、`data/import` 分离，license 独立 |
| R-7 不越层 | 无 mongoose/pgvector 直连（仅 provisioner 渲染 compose 字符串） |
| R-8 导入不抢管道 | 单任务队列 + 80% 暂挂 + 批量 2000 |
| 限流 20/5 每分钟 | `rate-limiter.service.ts` 一致性 |
| 并发 4/8/2 | `semaphore.ts` + 三处调用 |
| 被动 3.5s | 群聊不适用（appchat 无被动回复），已在 `wecom.controller.ts:196` 注明 |
