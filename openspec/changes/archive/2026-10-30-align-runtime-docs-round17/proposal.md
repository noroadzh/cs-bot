# Proposal

## Why

第十七轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-17.md`）发现详设 §3.2 仍把限流写成「令牌桶 + `rl:*` 键 + `tokenbucket.lua`」，实际是按分钟固定窗口与 `rate:*` 键；§3.3 的 `LPUSH` 表述容易被读成 Redis List；§3.2/§3.8 仍引用旧四位错误码；多处的反回放状态文件名 `license.state` 与实际 `license.lic.antireplay.json` 不符。

## What Changes

- 详设 §3.2：限流改为「按分钟固定窗口（Lua INCR+EXPIRE）」，键改为 `rate:group:{chatId}:{minute}` / `rate:user:{chatId}:{userId}:{minute}`，补 `rate:hint:{chatId}`（300s）。
- 详设 §3.3：上下文写入改为「读取 JSON 数组 → 截断保留 5 轮 → MULTI SET + EX 600s」。
- 详设 §3.2/§3.8：错误码 `1002/1004/1005` 改为符号名 `DEDUP_DUP` / `NOT_TRIGGERED` / `LICENSE_RESTRICTED`。
- 反回放状态文件名：概设 M9 两处、详设 §3.8/§5/§7 统一为 `license.lic.antireplay.json`。
- 版本：概设 V1.22、详设 V1.13。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：概要设计、详细设计、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
