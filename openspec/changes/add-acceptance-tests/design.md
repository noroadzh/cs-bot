# Design: add-acceptance-tests

## Context

详设 §9.2（6 容器全栈集成）与 §9.3（压测验收）尚未落地；现有测试为单测 + M10/M11 窄范围 integration。本 change 补齐 UAT 前的客观验收证据。

## Goals / Non-Goals

**Goals:**
- 一条命令起全栈、跑完整问答链路与关键边界、出报告。
- 压测覆盖 P95、限流、去重等指标。

**Non-Goals:**
- 不做生产容量规划（压测环境与生产同量级才有效）。
- 不替代 UAT 人工验收。

## Decisions

### D1: 全栈编排
`docker compose -f deploy/docker-compose.yml up -d` 起 6 容器；FastGPT 用真实容器或 mock（二选一，配置切换）；企微回调用签名 mock（复用 wecom-crypto 测试向量）。

### D2: 集成用例
覆盖：正常问答、低置信拒答 + miss_record、去重、限流、授权受限模式、图片识别失败引导。断言端到端可观测结果（回复文本、miss_record、usage）。

### D3: 压测工具
autocannon（HTTP 压测）或 k6（脚本化）；对 `/wecom/callback` 注入签名请求，测 P95/吞吐/错误率；限流用单群高频验证。

### D4: 报告与 CI
输出 JSON/HTML 报告到 `artifacts/`；CI 新增 acceptance job（`--profile acceptance` 或独立 compose），失败阻断。

## Risks / Trade-offs

- [R1 依赖外部服务] → FastGPT/企微 mock 化，降低不稳定。
- [R2 压测环境差异] → 报告标注环境规格；容量结论仅在同量级有效。
- [R3 运行时长] → acceptance 与 unit 分离，不阻塞日常 CI；nightly 或手动触发。

## Migration Plan

1. 新增 compose profile / 测试编排脚本。
2. 集成用例与压测脚本。
3. CI job + 报告产物。
4. 回滚：移除 job 即可，不影响功能。
