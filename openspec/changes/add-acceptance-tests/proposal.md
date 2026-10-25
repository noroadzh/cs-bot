# Proposal: add-acceptance-tests

## Why

详设 §9.2 要求「docker compose 起 6 容器的全栈集成测试」、§9.3 要求「压测验收（对应 PRD 指标）」。当前测试只有 50 个单测 + 2 个 M10/M11 integration，缺少覆盖 wecom→routing→qa→filter 完整链路的全栈集成与性能压测，UAT 前无客观验收证据。

## What Changes

- **全栈集成测试**：docker compose 起 nginx/adapter/fastgpt/pg/mongo/redis 6 容器，走「回调 → 触发 → 上下文 → FastGPT → 置信度 → 过滤 → 回复」与「未命中 → miss_record」完整链路；覆盖去重、限流、授权受限模式。
- **压测验收**：按详设 §11 指标——P95 ≤ 8s、每群 20 条/分钟、每人 5 条/分钟限流、去重幂等等；输出压测报告（吞吐/延迟/错误率）。
- **验收脚本与 CI**：可重复的 `test:acceptance` 脚本、docker compose 编排、测试数据与报告产物。

## Capabilities

### New Capabilities
- `acceptance-testing`: 全栈 6 容器集成测试与性能压测的验收口径、脚本与报告。

### Modified Capabilities
- `deployment-suite`: 增加集成/压测的编排与运行说明。

## Impact

- **代码/测试**：`apps/adapter/test/integration/`（全栈）、`scripts/` 或 `deploy/`（压测编排）。
- **CI**：新增 acceptance job（需 docker + 依赖容器）。
- **依赖**：docker compose、压测工具（如 k6/autocannon，二选一）。
- **风险**：全栈测试依赖外部服务（FastGPT/企微 mock）稳定性；压测环境资源需与生产同量级才有效。

## 备注

- 详设 §9.2/§9.3、§11；总纲见 `close-overview-design-gaps`。
- 本 change 只做验收测试，不含功能实现。
