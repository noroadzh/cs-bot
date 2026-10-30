# Proposal

## Why

第十六轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-16.md`）发现概设 M1 承诺「access_token 提前 5 分钟刷新」，实际只在缓存/TTL 到期才刷新，临界过期可能多一次失败请求。同时 §10.2 目录结构、§10.3 备份数据库数量与定时任务、§10.4 崩溃告警表述均与实际不符。

## What Changes

- **token 提前刷新**：`WecomClient.getAccessToken` 把「剩余 <300 秒」视为失效——内存缓存判断 `expireAt - 5min`，Redis 判断 `ttl > 300`；到期边界不再发出必然失败的请求。
- **文档修正**：
  - §10.2 目录结构改为实际（`deploy/docker-compose.yml`、`deploy/nginx/`、`logs/`、`apps/adapter/src/**/*.sql`、`license.lic.antireplay.json`）。
  - §10.3 备份数据库数改为三个（adapter/fastgpt/control-plane），补审计清理 `50 3` 与 SaaS 租户备份脚本；`deploy/backup.sh` 头注释同步。
  - §10.4 崩溃告警表述改为「容器 restart 自愈 + 宿主/云监控发现；webhook 覆盖 license/LLM/实例异常」。
- 版本：概设 V1.21、详设 V1.12。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `wecom-integration`：access_token 缓存要求补「提前 5 分钟刷新」与对应场景。

## Impact

- **代码**：`apps/adapter/src/wecom/wecom-client.ts`。
- **测试**：`wecom-client.spec.ts` 补内存/Redis 临界过期用例。
- **文档**：概设 §10.2/§10.3/§10.4、详设 §2.2、`deploy/backup.sh` 注释。
