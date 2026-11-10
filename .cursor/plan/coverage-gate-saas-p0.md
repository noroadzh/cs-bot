# coverage-gate-saas-p0

- **OpenSpec**: `openspec/changes/coverage-gate-saas-p0/`
- **权威 Scenario**: `specs/unit-testing/spec.md`
- **状态**: 已验证归档（`openspec/changes/archive/2026-11-10-coverage-gate-saas-p0`）

## 文件清单

| 文件 | 动作 |
|---|---|
| `openspec/changes/coverage-gate-saas-p0/**` | 契约 |
| `apps/adapter/test/import-lock.spec.ts` | 新增 |
| `apps/adapter/test/usage-webhook.service.spec.ts` | 新增 |
| `apps/adapter/jest.config.cjs` | P0 collect + 路径阈值 + 180s timeout |
| `apps/adapter/scripts/check-coverage-global.mjs` | 全局摘要门禁 |
| `apps/adapter/package.json` | `test:cov` 链式校验 |
| `AGENTS.md` | 门禁棘轮口径 |

## 验证（已通过）

```bash
pnpm -C apps/adapter test:cov
# 131 suites passed / 15 skipped；global statements/branches/functions/lines ≥ 75/60/70/75
```

## 口径备注

- 非整目录纳入 platform/import（避免稀释）；P0 盯关键服务文件
- Jest「global + 路径阈值」并存会算偏 → 全局改用 `check-coverage-global.mjs`
- 管道分支棘轮 ≥70%（行/语句/函数仍 ≥80%）；全局分支 ≥60%
- WSL/D: exceljs 单测可达 2min+，`testTimeout: 180_000`

## 下一步

- 用户确认后 archive change → `openspec/specs/unit-testing`
- 可选后续：补 `fastgpt-qa.engine` / `import-job.service` / `platform.controller` 覆盖后移回 collect
