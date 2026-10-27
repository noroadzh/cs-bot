# Proposal: add-acceptance-tests

## Why

详设 §9.2 要求全栈集成、§9.3 要求压测验收。但当前开发机**无法连接远程服务器且无外网**（pull 不到 FastGPT/Mongo/nginx 镜像），真实 6 容器栈在本机跑不起来。改用「**mock 全栈 + ab 压测**」在本地/CI 可落地地补齐 UAT 前的客观验收证据；真实 6 容器作为可选（有网/CI）。

## What Changes

- **Mock 全栈集成**：以真实 adapter + 本地 PG（真实）+ Redis（ioredis-mock）+ FastGPT（HTTP mock server）+ 企微签名（复用 wecom-crypto 向量）运行，走「回调 → 触发 → 上下文 → QA → 置信度 → 过滤 → 回复」与「未命中 → miss_record」，覆盖去重、限流、受限模式。
- **ab 压测**：用本地已安装的 Apache Bench 打 `/wecom/callback`（签名 mock），测 P95/吞吐/错误率，验证 ≤8s、限流、去重幂等。
- **验收脚本**：`test:acceptance`（mock 全栈 + 用例 + 压测 + 报告）。
- **可选真实 6 容器冒烟**：保留 compose 编排，标注「需 CI/有网环境执行」，无网络时跳过而不失败。

## Capabilities

### New Capabilities
- `acceptance-testing`: mock 全栈集成 + ab 压测的验收口径、脚本与报告。

### Modified Capabilities
- `deployment-suite`: mock 全栈验收编排 + 可选真实栈冒烟。

## Impact

- **测试**：`apps/adapter/test/acceptance/`（mock 全栈）、`scripts/`（ab 压测与报告）。
- **CI**：acceptance job（mock 默认；真实栈 nightly/有网，可跳过）。
- **依赖**：本地 Postgres（`postgres:16` 已具备）、`ab`（本地已装）、`ioredis-mock`（devDependency 已有）。
- **限制**：真实 6 容器需 pull 镜像，无外网时跳过。
- **风险**：mock 与真实 FastGPT 的行为差异需在 CI 真实栈补齐。

## 备注

- 详设 §9.2/§9.3、§11；总纲见 `close-overview-design-gaps`。
- 本 change 只做验收测试，不含功能实现。
