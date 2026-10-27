# Design: add-acceptance-tests

## Context

开发机无外网、不能连远程；真实 6 容器需 pull 镜像跑不起来。采用 **mock 全栈 + ab** 在本机可落地验收；真实栈作为可选（CI/有网）。

## Goals / Non-Goals

**Goals:**
- 一条命令在本地跑通完整问答链路与关键边界并出报告。
- ab 压测覆盖 P95、限流、去重。

**Non-Goals:**
- 不做生产容量规划（mock 环境不代表生产吞吐）。
- 不替代 UAT 人工验收。

## Decisions

### D1: Mock 全栈编排
- **adapter**：真实 Nest 进程（in-process 启动）。
- **PG**：本地 `postgres:16`（真实，已有容器/镜像）。
- **Redis**：`ioredis-mock`（devDependency 已有）。
- **FastGPT**：轻量 HTTP mock server（固定 quotes/score，可配置低分以触发拒答）。
- **企微**：签名 mock（复用 `wecom-crypto` 测试向量）注入 `/wecom/callback`。
由 jest 全局 setup 或独立脚本起 mock server + app。

### D2: 集成用例
正常问答、低置信拒答 + miss_record、去重、限流、授权受限模式、图片识别失败引导；断言 HTTP 响应 + DB（miss_record / usage）。

### D3: 压测工具
`ab`（本地 `/usr/sbin/ab` 已装）：生成带签名的 `/wecom/callback` 请求；测 P95/吞吐/错误率；限流用单群高频。

### D4: 报告与运行
输出 JSON/文本报告到 `artifacts/`；`test:acceptance` 串联 mock 全栈 + 用例 + 压测。

### D5: 可选真实 6 容器
保留 `deploy/docker-compose.yml` 冒烟，标注「需 pull 镜像（CI/有网）」，无网络时跳过；CI 有网时 nightly 运行。

## Risks / Trade-offs

- [R1 mock 与真实差异] → 真实栈在 CI 补齐；mock 主要用于链路与边界。
- [R2 压测代表性] → 报告标注 mock 环境，不作生产容量结论。
- [R3 运行时长] → acceptance 与 unit 分离，nightly/手动触发。

## Migration Plan

1. mock 全栈 harness（mock server + app 启动）。
2. 集成用例。
3. ab 压测 + 报告。
4. 可选真实栈 CI job。

## Open Questions

- FastGPT mock 的响应需覆盖：命中（高分）、低分拒答、超时/5xx 降级三类。
- ab 压测的目标并发量（建议与 SLO 并发档位对齐，如 20/50）。

## Implementation Notes (2026-10-27, post-verify)

- **D1 偏差（已接受）**：FastGPT mock 落在 axios 层（`jest.mock('axios')`），未起独立 HTTP mock server。
  覆盖引擎调用契约与三态（高分/低分/超时-5xx），但不覆盖 axios/HTTP 配置本身；
  真实 HTTP 行为由可选 6 容器冒烟兜底。
- **D3 补强**：ab 阶段仍用 fake crypto 注入；另增 `test/acceptance/callback-signature.spec.ts`，
  按 WXBizMsgCrypt 规范构造 AES-CBC 密文 + SHA1 签名，真实走「验签 → 解密 → XML 解析」HTTP 回调。
- **限流报告**：`load.spec.ts` 增加 20/min 群限流阶段（200 请求 / 30 轮换用户），
  报告 `ab-limiter-report-*.json` 记录 `processedMessages` 与 `limiterEngaged`。
- **运行说明**：`test:acceptance` 带 `--forceExit`（native license N-API 的 CustomGC 句柄不释放）。
