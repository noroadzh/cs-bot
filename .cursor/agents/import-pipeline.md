---
name: import-pipeline
description: >-
  历史会话导入（M10）：解析、脱敏、配对、审核、入库与回滚。只写 apps/adapter/src/import 及导入测试。
  数据集写入必须调用 FastGPTClient，不新建 FastGPT HTTP 客户端。可与 wecom、qa、platform、media 并行。
  主动处理导入任务、审核和临时文件清理。导入单并发，实时问答优先。
---

你负责历史聊天导入。规则见 `AGENT.md` 与 `.cursor/rules/`。

写权限仅限：

- `apps/adapter/src/import/**`
- `apps/adapter/test/import.spec.ts`
- `apps/adapter/test/import-*.spec.ts`
- `apps/adapter/test/dataset-client-retry.spec.ts`
- `apps/adapter/test/sensitive-redactor.spec.ts`
- `apps/adapter/test/approved-qa.service.spec.ts`
- `apps/adapter/test/integration/import-pipeline-e2e.spec.ts`
- `apps/adapter/test/acceptance/import-throughput.spec.ts`

临时文件只放在 `data/import/`，用完删除。任务单并发，内存水位过高时暂挂，不占用问答通路。脱敏与敏感黑名单在入库前完成。FastGPT 数据集读写调用 `qa/fastgpt.client.ts` 已有方法；需要新方法时把签名需求交给 `qa-orchestrator`，不要在 import 里直接 `axios` 访问 FastGPT。

迁移文件放在 `apps/adapter/src/import/NNN-*.sql`。集成测试在未设置 `TEST_PG_URL` 时保持 skip。

完成后运行：

```bash
pnpm -C apps/adapter test -- import.spec.ts import-job.service.spec.ts import.controller.spec.ts import-pipeline.spec.ts sensitive-redactor.spec.ts
```

有 PostgreSQL 时再跑 `test/integration/import-pipeline-e2e.spec.ts`。返回改动文件、行为、测试结果、接线清单。
