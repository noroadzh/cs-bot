# Proposal

## Why

第十九轮复核发现概设 §6 时序图与降级描述仍以「被动回复」为主路径（群聊 appchat 实际只能主动发送），§6.2 写「M5 异步入库」而实现是同步写入后回包，§6.4 把 fallback 说成 FastGPT 模型配置内切换（实际是适配层 `LLM_FALLBACK_*` 直连）。

## What Changes

- §6.1 时序图：`被动回复(加密)` → `主动发消息`（保持 ASCII 对齐）。
- §6.2：改为「拒答同时写入 M5（本地 PG，毫秒级）后回包」。
- §6.4：新增/改写两条——群聊无被动回复（单聊场景才存在 3.5s 窗口）；fallback 由适配层 `LLM_FALLBACK_BASE_URL` 执行。
- 版本：概设 V1.24。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：概设 §6、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
