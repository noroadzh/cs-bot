# 概要/详细设计完整性复核（第五轮，2026-10-29，只读）

## 范围与方法

- 基准：概设 V1.11、详设 V1.3（文档对齐后版本）。
- 覆盖：M1–M11 功能、公共组件（HttpClient/WecomClient/FastGPTClient/license-native）、Redis 键、API 契约、定时任务、构建管线、测试设计。
- 只读检查代码、规格、测试与配置。

## 结论

**设计中的功能条目已全部实现。** 本轮发现 2 项「规格/设计与实现不一致」（其中 1 项涉及隐私约束），需修复；1 项压测口径差异属环境取舍。

## 需要修复（P1）

### 1. `/admin/miss-records?format=json` 未脱敏 `userid`，且字段名与规格不符

- 规格 `openspec/specs/miss-record/spec.md:19-29`：JSON 必须返回 `{total, items:[{question, chatId, score, mediaType, status, createdAt}]}`，且 `userid` 在两种格式中都必须 `<first-2>****` 掩码。
- 实现 `apps/adapter/src/admin/miss.controller.ts:34-36`：`res.json({ total: rows.length, rows })`，直接返回 `queryRecords` 的原始行（含完整 `user_id`、`trace_id`、`engine`），既未掩码也未用 `items`。
- xlsx 路径已正确掩码（`miss-export.service.ts:99` 使用 `maskPII(..., 'userid')`）。
- 影响：管理接口 JSON 导出会泄露完整 userid，违反规格明文约束。
- 建议：JSON 分支改为 `items` 并按规格投影字段 + `maskPII`；补测试断言无原始 userid。

### 2. 详设 §2.1 描述的 `HttpClient` 抽象未实现（实现为各客户端直连 axios）

- 详设要求统一 `HttpClient.request({retries, backoffBaseMs, semaphore})`，实际为 `wecom-client.ts:26`、`fastgpt-qa.engine.ts:24/35`、`media-recognize.service.ts` 各自 `axios.create`，重试分散在 `withSendRetry` 与 `fastgpt-qa.engine` 内部，信号量由 `common/semaphore.ts` 提供并被三处直接调用。
- 功能等价（信号量上限 `LLM_CONCURRENCY=4/WECOM_CONCURRENCY=8/VL_CONCURRENCY=2` 均生效），但公共组件契约与文档不符。
- 建议：文档承认实现形态（各客户端 + 公共 Semaphore），或后续抽取 HttpClient；本次按文档对齐处理。

## 可接受差异（非缺口）

### 3. 压测口径：50 并发 vs 20 并发

- 详设 §9.3：50 并发回调持续 10min；`apps/adapter/test/acceptance/load.spec.ts:34-35` 为 `REQUESTS=200`、`CONCURRENCY=20`（mock 全链路）。
- 判断：mock 环境下 50 并发无额外信息量，真实压测在 UAT 执行；验收指标（P95 ≤8s、失败 0）一致。属环境取舍，记录不改。

## 逐模块复核（本轮抽查确认）

| 模块/组件 | 结论 |
|---|---|
| M1 WecomClient | sendText/sendFile/sendVideo/uploadMedia/downloadMedia/getAccessToken 齐备，token 缓存 7000s + Redis 锁 |
| M2 路由 | 触发、去重 48h、限流 20/5 每分钟、提示 5 分钟去重 |
| M3 上下文 | 5 轮、600s 滑动、fail-open |
| M4 问答 | `quoteList` 解析、`score=max`、15s 超时、1s 重试、来源 2 条 |
| M5 未命中 | 异步入库、xlsx 流式、90 天清理；**JSON 导出待修（见 P1-1）** |
| M6 敏感词 | DFA + watch + 整段替换 |
| M7 配置 | 启动校验、config-check/reload/keywords reload |
| M8 多媒体 | qwen-vl、素材标记 UUID、上限 2、外发降级 |
| M9 授权 | native verify/fingerprint/antireplay/selfcheck；群数拦截；03:00 复核；受限 503；reload |
| M10 导入 | 四种解析器、30 分钟窗口配对、审核门禁、幂等重试、80% 暫挂、30/180 天清理 |
| M11 控制面 | 编排/端口序列/证书/配额/订阅状态机/升级金丝雀/审计链/注销/监控 |
| 构建管线 | javascript-obfuscator + 剔除 .map（Dockerfile 70-90 行）；`release-hardening.spec` 断言 |
| 定时任务 | 03:00 license、03:30 miss、03:40 导入清理、09:00 到期提醒、02:30 用量上报、03:50 审计清理 |
