# Proposal

## Why

对概设 V1.26 / 详设 V1.16 做全量逐节核对，发现 1 项**实现违反规格**（空引用答案被当作 0.8 高分命中，绕过拒答与未命中记录，违反 `qa-orchestration`「空 quotes → score 0」与 ADR A4「宁可拒答不可编造」），以及 15 处文档与实现不一致（选型版本、被动回复残留、素材/脱敏/订阅扫描/构建管线等）。

## What Changes

**代码（对齐既有规格，无 spec delta）**
- `parseChatResponse`（`fastgpt.client.ts`）与引擎自带解析（`fastgpt-qa.engine.ts`）：`score = quotes.length ? max(quote.score) : (data[0].score ?? 0)`——空引用不再默认 0.8。
- 更新 3 处受影响单测；新增 1 个编排器用例「空 quotes → 记 miss + 拒答话术」。

**文档**
- 概设：§1 引用版本/日期；§3.3 形态 A 图补 8443；§4 选型表 PG16/默认 schema、Mongo7、Nginx1.27；§4.3 hybrid 超时以 `LLM_TIMEOUT_MS` 判定、健康探测探 `/`、CPU 未硬限；§10.1 adapter 去掉「CPU 1.0」、watchtower 标注未启用；§8.1/§11.1/§11.4 被动回复表述改群聊主动发送；§12 风险 3 watchtower 预案改镜像回滚。
- 详设：§2.3 置信度「皆无则 0.8」→ 0；§3.1 去掉 3.5s 竞速、错误码改符号名；§3.4 拒答文案/`LLM_TIMEOUT`/素材引用 `<uuid>`；§3.7 上传参数与 `ASSET_*` 错误码；§3.8 群数上限改为运行时准入；§3.9 脱敏来源与姓名字典；§3.10 订阅扫描 09:00 + `expired_at`；§8 控制面同镜像双入口。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。代码改动是恢复既有 `qa-orchestration` 规格一致性，不改变规格本身，`skip_specs: true`。）

## Impact

- **代码**：`apps/adapter/src/qa/fastgpt.client.ts`、`apps/adapter/src/qa/fastgpt-qa.engine.ts`。
- **测试**：`fastgpt-client.spec.ts`、`fastgpt-qa.engine.spec.ts`、`qa-orchestrator.spec.ts`。
- **文档**：概要设计、详细设计、文档清单与交叉引用。
- **行为**：无引用/无原生得分的回答将按 0 分拒答并记 miss（与规格一致）；有引用或 `data[0].score` 的路径不变。
