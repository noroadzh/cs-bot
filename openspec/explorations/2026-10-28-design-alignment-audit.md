# 设计与实现核对（2026-10-28，只读）

## 问题

对照《概要设计 V1.9》《详细设计 V1.1》核对实现，找出偏差并给出修改建议。

## 范围

M1–M11 全部模块，重点 M10 导入、M11 控制面、部署权限基线。

## 结论

消息链路、RAG 问答、未命中、敏感词、媒体、授权与设计一致。剩余偏差集中在三处：

| 级别 | 偏差 | 证据 |
|---|---|---|
| P0 | 注销未按“导出→确认收货→7 天删除”，且无 confirmToken | `apps/adapter/src/platform/tenant-offboarding.ts:29`、`platform.controller.ts:291` |
| P0 | 导入“丢弃”条目正文仍落库 | `apps/adapter/src/import/import-job.service.ts:1207`（无清空逻辑） |
| P0 | 反代下管理面 IP 白名单失真（未采信可信代理头） | `apps/adapter/src/admin/admin.guard.ts:34`、`deploy/nginx/nginx.conf:39`、`apps/adapter/src/main.ts`（无 trust proxy） |
| P1 | 导入缺条目级去重键/会话元数据/阶段计数 | `apps/adapter/src/import/004-import-job.sql:29`、`007-import-pipeline.sql:5` |
| P1 | 审核清单会话哈希=job id、发生时间=导入时间 | `import-job.service.ts:1278-1280` |
| P1 | 审核状态缺 `modified` | `import-job.entity.ts:44` |
| P1 | 导入无单任务互斥 | `import.controller.ts:161`（无锁） |
| P1 | 监控自动重启未接线 | `platform.module.ts:67-76`、`platform-monitor.ts:62-64` |
| P2 | 容器默认 root | `deploy/docker-compose.yml:27,60` |
| P2 | 租户 FastGPT 管理口 8443 无来源限制 | `platform/provisioner/shell-provisioner.ts:101-102,237` |
| P2 | 无 ESLint/模块边界校验 | 仓库无 ESLint 配置 |

## 修订说明

- 平台路由（`PATCH /quota`、`/platform/audit-log`）与任务状态词表（`uploaded/parsed/...`）经查已被 OpenSpec 主规格冻结，实现与规格一致；冲突在设计文档。处理方式为修订设计文档，仅新增 `rolled_back` 状态。
- `local-model-routing` 规格仍描述已被 FastGPT RAG 替代的直连本地 LLM 路径，需单独变更重写，不在本次范围。

## 后续

已落成变更 `openspec/changes/align-design-implementation-details/`。
