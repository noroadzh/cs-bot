# Proposal

## Why

第七轮复核（`openspec/explorations/2026-10-29-design-completeness-recheck-7.md`）发现：概设 §10.1 为 4C8G 单机给出每服务内存限额并声明「内存限额硬隔离」，但基线 compose 完全没有 `mem_limit`，Redis 也未配 `maxmemory`；任一组件内存异常增长会触发宿主 OOM 杀死其它容器。同时 §12 风险 4 承诺的「验签失败告警」未实现，企微配置错误只能在日志里发现。详设 §9.1 测试设计仍写「令牌桶」「3.5s 竞速」，与实现不符。

## What Changes

- **资源限额落地**：基线 `deploy/docker-compose.yml` 为 6 个服务加 `mem_limit`（nginx 128M / adapter 512M / fastgpt 2.5G / mongo 1G / pg 1.2G / redis 512M）；Redis 启动参数加 `--maxmemory 384mb --maxmemory-policy allkeys-lru`；SaaS 叠加文件为 control-plane 加 512M。新增 `RESOURCE_LIMITS` 说明与 `install.sh --check` 的宿主内存校验（≥7G 可用）。
- **验签失败告警**：新增 `OpsAlertService`（统一运维告警：冷却期 + `OPS_WEBHOOK_URL`，失败只 WARN）；企微验签失败按冷却期推送一次，不影响 401 响应。
- **文档对齐**：详设 §9.1 改为「固定窗口边界」，删除群聊不适用的 3.5s 分支；概设 §10.1 镜像版本更新为实际（nginx 1.27 / mongo 7 / pgvector pg16）并注明限额已在 compose 落地。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：新增「每服务内存限额与 Redis maxmemory」要求。
- `observability-logging`：新增「验签失败运维告警」要求。

## Impact

- **配置**：`deploy/docker-compose.yml`、`deploy/docker-compose.saas.yml`、`deploy/install.sh`、`.env.template`（告警冷却）。
- **代码**：新增 `apps/adapter/src/common/ops-alert.service.ts`；`wecom.controller.ts` 接入告警。
- **测试**：新增 `ops-alert.spec.ts`、`deploy-runtime.spec.ts` 限额断言、`wecom.controller.spec.ts` 告警断言。
- **文档**：概设 §10.1/§12、详设 §9.1、部署手册。
