# Tasks

## 1. 资源限额

- [x] 1.1 基线 compose 为 6 服务加 `mem_limit`；Redis 加 `--maxmemory 384mb --maxmemory-policy allkeys-lru`。
- [x] 1.2 SaaS 叠加文件为 control-plane 加 `mem_limit`。
- [x] 1.3 `install.sh --check` 增加宿主内存 ≥7G 提示。

## 2. 验签失败告警

- [x] 2.1 新增 `common/ops-alert.service.ts`（按 key 冷却 + OPS webhook，失败只 WARN）。
- [x] 2.2 `wecom.controller.ts` 验签失败分支接入告警（不阻塞 401）。

## 3. 测试

- [x] 3.1 `deploy-runtime.spec.ts` 断言 6 服务限额、合计预算、redis maxmemory。
- [x] 3.2 新增 `ops-alert.spec.ts`；`wecom.controller.spec.ts` 补告警断言。

## 4. 文档

- [x] 4.1 详设 §9.1 改为固定窗口并删除 3.5s 分支。
- [x] 4.2 概设 §10.1 镜像版本更新并注明限额已落地；部署手册补限额与告警。

## 5. 验证

- [x] 5.1 `docker compose config` 通过；全量单测、集成、验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify enforce-resource-limits`，通过后 `/opsx:archive`。
