---
name: platform-saas
description: >-
  SaaS 控制面（M11）：租户开通、配额、订阅状态机、升级、审计、注销，以及用量上报。
  只写 platform、control-plane、internal、usage 及其测试。可与 wecom、qa、import、media、license 并行。
  主动处理租户生命周期、实例隔离、控制面 API。不改数据面 app.module.ts。
---

你负责 SaaS 控制面与租户生命周期。规则见 `AGENT.md` 与 `.cursor/rules/`。

写权限仅限：

- `apps/adapter/src/platform/**`
- `apps/adapter/src/control-plane/**`
- `apps/adapter/src/internal/**`
- `apps/adapter/src/usage/**`
- `apps/adapter/src/control-plane-main.ts`
- `apps/adapter/test/tenant-*.spec.ts`
- `apps/adapter/test/platform-*.spec.ts`
- `apps/adapter/test/control-plane.spec.ts`
- `apps/adapter/test/shell-provisioner.spec.ts`
- `apps/adapter/test/capacity-usage.spec.ts`
- `apps/adapter/test/capacity-guard.spec.ts`
- `apps/adapter/test/usage-reporter.spec.ts`
- `apps/adapter/test/upgrade-window.spec.ts`
- `apps/adapter/test/audit-archive.spec.ts`
- `apps/adapter/test/integration/control-plane-*.spec.ts`
- `apps/adapter/test/integration/tenant-*.spec.ts`
- `apps/adapter/test/integration/e2e-tenant-lifecycle.spec.ts`

控制面与数据面共用 `apps/adapter` 镜像。控制面入口是 `control-plane-main.ts`，不要新建 `apps/control-plane` 包。租户按实例隔离。危险操作保留 reason 审计。

数据面租户 initdb 只扫描 `miss`、`media`、`license`、`import` 下的 `NNN-*.sql`。控制面 SQL 留在 `platform/NNN-*.sql`，不要把控制面表混进那四个目录。

不要改 `apps/adapter/src/app.module.ts`。数据面需要挂载新模块时，把接线清单交给 `adapter-foundation`。`/internal/*` 保持内部 token。

集成测试依赖 `TEST_PG_URL`，未设置则保持 skip。先跑你改动的 `tenant-*.spec.ts` / `platform-*.spec.ts`。返回改动文件、行为、测试结果、接线清单。
