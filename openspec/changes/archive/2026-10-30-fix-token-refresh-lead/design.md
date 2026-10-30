# Design

## Context

见 proposal.md。`getAccessToken` 当前判断：内存 `Date.now() < tokenCache.expireAt`、Redis `ttl > 0`；到期才刷新。

## Goals / Non-Goals

**Goals:**

- 提前 300 秒刷新，避免临界过期请求失败。
- 部署章节文档与实现一致。

**Non-Goals:**

- 不改刷新锁与并发语义（SETNX + 2s 重试保持）。
- 不引入主动定时刷新（仍是懒刷新，只是提前量）。

## Decisions

### D1 提前量

- 常量 `TOKEN_REFRESH_LEAD_SEC = 300`。
- 内存缓存：`Date.now() < expireAt - 300_000` 才直接返回。
- Redis：`ttl > 300` 才接受缓存；否则走刷新路径（抢锁 → `/gettoken` → SETEX）。
- 刷新成功后 `expireAt = now + expires_in*1000` 保持不变；下次判断自然带提前量。

### D2 测试

- 内存缓存 `expireAt = now + 120s` → 调用 API 刷新。
- Redis `ttl = 120` → 调用 API 刷新。
- 既有用例（3600s / ttl 7000）保持通过。

### D3 文档

- 概设 §10.2：目录树改实际布局（deploy/、logs/、迁移、antireplay 状态文件名）。
- 概设 §10.3：三个 database（adapter/fastgpt/control-plane）+ 审计清理 03:50 + SaaS 租户备份脚本；`deploy/backup.sh` 头注释同步。
- 概设 §10.4：崩溃告警措辞改为「容器 restart 自愈 + 宿主/云监控；webhook 覆盖 license/LLM/实例异常」。
- 详设 §2.2：token 缓存条目补「剩余 <300s 提前刷新」。

## Risks / Trade-offs

- [提前刷新增加 token 获取频率] → 最多每 7000s 多一次，可忽略。
- [Redis 与内存 TTL 不完全一致] → 两者都带同一提前量，行为一致。

## Migration Plan

无数据/配置变更；发布即生效。

## Verification

- `wecom-client.spec.ts` 两条临界过期用例 + 既有用例全绿。
- 全量单测/集成/验收通过。
