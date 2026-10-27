# Proposal: close-overview-design-gaps

## Why

MVP 基线与 M9 授权（M1–M9 + 增项 A）已全部交付并归档；M10 导入（增项 B）与 M11 控制面（增项 C）按各自 spec 已完成，但实现只覆盖了「主干闭环」，与概要设计描述的完整能力存在明显差距。增项 D（本地模型）目前只在部署手册中有配置项，代码层完全未实现；详设 §9.2/§9.3 的全栈集成测试与压测验收也尚未落地。本变更用于把这些差距收敛为可交付的范围。

## What Changes

本提案建议按 **4 个阶段** 实施（可整体作为一个 change，也可拆成 4 个独立 change 依次交付）：

### Phase 1 — M10 导入重管线（增项 B 补齐）
- 上传内容嗅探（企微存档 JSON 结构 / 三列表头识别）
- 清洗规则（系统消息/占位消息/机器人自身消息/刷屏去重/无实义短消息），规则文件 `config/import-rules.yml`
- 会话切分与 QA 配对（30 分钟窗口、客户侧聚合为问、客服侧首条实质回复为答、多轮合并、单边入未配对池）
- 敏感剔除黑名单 `config/import-blacklist.txt`（与 M6 出站词库独立）
- 近似去重（调 FastGPT 检索 top1，score ≥ 0.9 标记近似已有）
- 审核清单 `review.xlsx` 生成 + `confirm` / `rollback` / `retry` 端点
- approved 条目写入 FastGPT 独立数据集（`历史语料-{jobId}`），批次下线 = 删 collection

### Phase 2 — M11 控制面运营能力（增项 C 补齐）
- 完整开通编排：独立 DB 名/Redis/Mongo/数据目录初始化、TLS 证书申请、订阅期授权证书签发
- 租户密钥库（AES-256 + 主密钥，文件权限 600）
- 订阅提醒（T-30/15/7 邮件 + 运维群）
- 批量升级与灰度（`/platform/upgrades`，金丝雀 → 观察 24h → 全量，失败自动回滚）
- 监控聚合与平台总览（`/platform/usage`，聚合各实例 healthz/失败率/资源水位）
- 双签注销与数据导出（`/platform/tenants/:id/export`、`/destroy`，T+7 删除 + 删除确认单）
- 状态机对齐概设：`trialing → active → grace → suspended → terminated`（兼容现有 `created/provisioning/paused`）

### Phase 3 — 增项 D 本地模型模式
- 新增 `MODEL_MODE`（cloud / hybrid / local）、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL` 配置
- hybrid：本地优先、超时/故障自动切云；local：全本地、故障回繁忙话术不出域
- 与现 QaOrchestrator/FastGPT 调用链的降级路由

### Phase 4 — 验收测试补齐
- 详设 §9.2 全栈集成测试（docker compose 起 6 容器，走完整问答链路）
- 详设 §9.3 压测验收（P95 ≤ 8s、限流、去重幂等等指标）

## Capabilities

### New Capabilities
- `import-pipeline`: M10 清洗/切分配对/黑名单/近似去重/审核清单/批次回滚
- `tenant-provisioning`: M11 完整开通编排（TLS/独立资源/密钥库/授权签发）
- `tenant-upgrade`: M11 批量升级/灰度/自动回滚
- `platform-monitoring`: M11 监控聚合与平台总览
- `local-model-routing`: 增项 D 本地模型模式与降级路由

### Modified Capabilities
- `import-job`: 增加清洗/切分配对/审核清单/confirm/rollback/retry 的端点与状态
- `import-review`: approved 条目写入 FastGPT 独立数据集（替代/补充当前本地 `approved_qa`）
- `tenant-registry`: 状态机对齐概设、订阅提醒、双签注销/导出
- `tenant-quota`: 配额下发实例、LLM token 月度上限
- `deployment-suite`: 本地模型部署（vllm/xinference）、监控与压测验收

## Impact

- **代码**：
  - `apps/adapter/src/import/`（清洗/配对/清单/回滚/FastGPT dataset client）
  - `apps/adapter/src/platform/`（provisioner 扩展、upgrade、monitoring、offboarding、secrets）
  - `apps/adapter/src/qa/` 或新 `model-routing/`（增项 D）
  - `apps/adapter/src/config/config.schema.ts`（MODEL_MODE 等）
- **API**：新增 `review.xlsx`/`confirm`/`rollback`/`retry`、`/platform/upgrades`、`/platform/usage`、`/platform/tenants/:id/export|destroy`；`/platform/tenants/:id/quota` 方法/路径对齐
- **SQL**：`import_job`/`import_item` 增加阶段计数与 imported_qa_id；平台侧表按需扩展
- **配置**：`MODEL_MODE`、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`、`IMPORT_MAX_FILE_BYTES`（概设为 200MB）
- **依赖**：FastGPT 数据集 API、TLS 签发通道、邮件服务（提醒）、对象存储/独立实例编排参数
- **测试**：全栈集成 + 压测（新增）
- **风险**：范围大、跨模块多；建议按 4 个阶段拆分交付，每阶段独立可验收

## 备注

- 本提案是「概设差距补齐」的总纲；若整体实施，tasks 预计 40+ 项。**建议拆分为 4 个独立 change**：`complete-m10-import-pipeline`、`complete-m11-control-plane`、`add-local-model-mode`、`add-acceptance-tests`，依次走 `/opsx:propose` → `/opsx:apply` → `/opsx:archive`。
- 概设原文见 `docs/02-需求与设计/概要设计-微信群智能客服机器人MVP.md` §5（M10/M11）、§4.3（增项 D），详设见 `详细设计-...md` §3.9/§3.10/§9。
