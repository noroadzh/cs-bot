# Tasks

- [x] 1.1 `WecomClient` 增加 300s 提前刷新（内存与 Redis 双侧判断）。
- [x] 1.2 `wecom-client.spec.ts` 补内存/Redis 临界过期用例。
- [x] 2.1 概设 §10.2/§10.3/§10.4 与 `deploy/backup.sh` 注释修正。
- [x] 2.2 详设 §2.2 token 缓存说明补提前量。
- [x] 3.1 版本与引用同步（概设 V1.21 / 详设 V1.12）。
- [x] 4.1 全量单测/集成/验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify fix-token-refresh-lead`，通过后 `/opsx:archive`。
