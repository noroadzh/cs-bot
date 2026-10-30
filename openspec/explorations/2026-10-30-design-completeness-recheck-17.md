# 概设/详设完整性复核（第十七轮，2026-10-30，只读）

## 范围

基准：概设 V1.21、详设 V1.12。本轮核对 **M2 限流、M3 上下文、M9 反回放状态文件** 的实现细节表述与错误码引用。

## 结论

功能无缺口。发现 **4 处文档与实现不一致（均为 P2）**。

## P2 文档不一致

### 1. 详设 §3.2 限流描述过时

- 文档：「限流（**令牌桶**，Redis Lua 原子）」；键 `rl:group:{chatId}` / `rl:user:{c}:{u}`；「Lua 脚本 `tokenbucket.lua`：INCR + EXPIRE」。
- 实际 `rate-limiter.service.ts`：**按分钟固定窗口**（Lua `INCR` + 首次 `EXPIRE 60`），键 `rate:group:{chatId}:{minute}` / `rate:user:{chatId}:{userId}:{minute}`，另有 `rate:hint:{chatId}`（300s，群提示去重）；脚本常量名为 `LUA_TOKEN_BUCKET` 但语义是固定窗口计数器。
- 建议：改为「按分钟固定窗口（Lua INCR+EXPIRE）」并更新键名/脚本说明。

### 2. 详设 §3.3 上下文写入方式

- 文档：「超过 5 轮：`LPUSH` 语义截断（数组 shift 最旧）」——容易被读成 Redis List。
- 实际 `context.service.ts`：`GET` 取 JSON 数组 → 截断 → `MULTI SET ... EX ttl` 写回（字符串，非 List）。
- 建议：改为「读取 → 截断保留最近 5 轮 → 写回并续期 EX 600s」。

### 3. 旧错误码残留

- 详设 §3.2：去重终止「（1002）」；未触发「静默(1004)」；§3.8：受限模式「（1005）」。
- 实际枚举（`packages/shared/src/errors.ts`）：`DEDUP_DUP=20002`、`NOT_TRIGGERED=20001`、`LICENSE_RESTRICTED=90001`（五位码）。
- 建议：改用符号名（`DEDUP_DUP`/`NOT_TRIGGERED`/`LICENSE_RESTRICTED`），避免码值再变时漂移。

### 4. 反回放状态文件名

- 文档多处写 `license.state`（概设 M9 两处；详设 §3.8、§5 注、§7 定时任务表）。
- 实际 `license.service.ts:157`：`${LICENSE_FILE}.antireplay.json`（即 `license/license.lic.antireplay.json`）。
- 建议：统一为实际文件名。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 限流行为 | 群超限静默 + 5min 一次提示；用户超限回「提问太频繁」 |
| 上下文 TTL/轮数 | 600s 滑动续期、5 轮截断、Redis 故障 fail-open |
| 关键词热加载 | Trie 原子替换 |
| 反回放逻辑 | `antireplay(statePath, now)` 状态文件读写、回拨即失效 |
