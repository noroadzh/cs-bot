# Proposal: close-design-gaps-v2

## Why

按《概要设计 V1.9》《详细设计 V1.1》《PRD V1.5》逐条核对，主干数据面（M1–M9）与 M10 管线已基本落地，但仍存在会阻断 UAT/交付的偏差：增项 D 的 `MODEL_MODE` 只在配置层存在、`ModelRouter` 无任何调用方；部署编排漏挂 `import/007` 与 `platform/008` 两个迁移；FR-9 语音/视频/文件入站与 `miss_record.media_type` 未实现；M11 的证书/签发/监控/升级/导出默认走桩；FR-2/FR-3 的提问文本剥离、空问题守卫与来源引用缺失。上一轮归档的 change 中个别任务（如 add-local-model-mode 3.1）标记完成但运行时未接线，需要以本变更统一收口并补验收证据。

## What Changes

按三个优先级分批交付（同一 change 内分阶段，实施时可再拆子 change）：

**P0 — 阻断项**
- 接线增项 D：`MODEL_MODE` 启动校验（local/hybrid 缺本地端点即 fail-fast），在 QaModule 构造 `ModelRouter` 并注入 `QaOrchestrator`；local 档零云端出站，hybrid 本地优先/熔断切云。
- 部署迁移完整性：`docker-compose.yml` 与 `Dockerfile.adapter` 覆盖全部 9 个 SQL（含 `import/007-import-pipeline.sql`、`platform/008-control-plane.sql`），并加一致性校验脚本/测试。
- FR-9 入站多媒体：语音/视频/文件（@机器人）回复引导话术并写 `miss_record(media_type)`；`miss_record` 增补 `media_type`、`status` 列并进入导出。
- M11 生产适配器：证书、订阅授权签发、实例健康探测、升级快照/回滚、导出/删除改为可配置的真实实现（保留 fake 供测试），禁止默认静默使用桩。
- FR-2/FR-3：剥离 @机器人 与触发词后再问答；空问题/纯标点/>500 字守卫；答案来源引用（≤2 条）；主模型通道失败重试 1 次；对齐 FastGPT 契约（chatId/histories/quoteList）。

**P1 — 重要项**
- 群白名单（仅处理已配置客户群）；限流超限提示（群 5 分钟一次、单人话术）；Redis 故障时内存去重兜底；出站 LLM/WeCom/VL 信号量；关键词 Trie 与热加载（对齐既有 spec）。
- 日志 PII 脱敏中间件（手机号/身份证/姓名）；敏感词审计日志含 hitWord。
- 素材：视频 ≤10MB、md5 去重、落盘 0600；导入：默认 200MB、5 万条上限、review.xlsx/import_item 保留清理、R-8 内存暂挂。
- 交付侧 `tools/license-issuer` 签发工具；构建启用 JS 混淆、剔除 sourcemap、产出 SHA256SUMS。
- M11：配额 80% 预警；T-30/15/7 提醒接入定时任务；grace 只读（禁止加群/改知识库）；D10 用量计数上报端点与 7 天缓存；审计 180 天清理。

**P2 — 验收补齐**
- ab 50 并发持续 10 分钟；导入 1 万条 ≤10 分钟吞吐；覆盖率门禁按既有 spec（管道 80% / 横切 60%）落地。

**非目标**：不改变已冻结的对外 API 契约；不引入新框架；不做二期功能（多模型路由、知识库前端、K8s 编排）。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `local-model-routing`: 增加运行时接线与启动校验要求（三档真正生效、local 零出站可验证）。
- `deployment-suite`: 增加迁移完整性与交付加固（混淆、无 sourcemap、镜像摘要）要求。
- `media-recognition`: 修正“非图片按普通文本处理”的旧口径，改为语音/视频/文件引导话术。
- `miss-record`: 增加多媒体类型与处理状态字段及导出要求。
- `qa-orchestration`: 增加提问归一化、输入守卫、来源引用与主通道重试要求。
- `message-routing`: 增加群白名单、限流反馈、Redis 降级去重与出站并发上限要求。
- `tenant-quota`: 增加配额 80% 预警要求。
- `tenant-registry`: 增加适配层用量上报控制面（D10）要求。
- `import-pipeline`: 增加容量上限、保留期清理与内存保护要求。
- `media-management`: 增加视频大小上限、md5 去重与文件权限要求。
- `license-build`: 增加交付侧签发工具要求。
- `acceptance-testing`: 增加持续压测与导入吞吐验收要求。

## Impact

- **代码**：`qa/model-router` 接线与 `qa.module`/`qa-engine.module`；`wecom.controller`/`miss`；`routing`；`filter`/`common/logger`；`media`；`import`；`platform`（provisioner 适配器、monitor、upgrade、offboarding、quota、reminder、usage 上报）；`config.schema`。
- **部署**：`deploy/docker-compose.yml`、`deploy/Dockerfile.adapter`、构建脚本、`tools/license-issuer`。
- **数据库**：新增 `009-miss-media-status.sql`（列补齐）；确认 008 控制面表在部署中生效。
- **测试**：单测补齐接线/守卫/Trie/PII/白名单；验收补 50 并发 10 分钟与导入吞吐；CI 增加迁移一致性与覆盖门禁。
- **兼容性**：新增列为可空/有默认值，向后兼容；`MODEL_MODE=cloud` 行为不变。
- **风险**：M11 真实适配器依赖外部 TLS/签发/docker 能力，需按环境注入；真实 6 容器与生产验证仍受网络/服务器可达性限制。
