## 1. 规格与施工单

- [x] 1.1 proposal / design / unit-testing delta
- [x] 1.2 `.cursor/plan/coverage-gate-saas-p1.md`

## 2. 摸底与补测

- [x] 2.1 临时恢复三文件 collect，跑相关 spec 覆盖率摸底
- [x] 2.2 补 `fastgpt-qa.engine` 分支缺口至 ≥50%（目标 ≥60% 行）
- [x] 2.3 补 `import-job.service` 未覆盖关键路径至阈值
- [x] 2.4 补 `platform.controller` 高风险动作至阈值

## 3. 门禁

- [x] 3.1 去掉三文件排除；加单文件 coverageThreshold
- [x] 3.2 `pnpm -C apps/adapter test:cov` 全绿（1125 passed；P1 三文件均达阈值）

## 4. 收尾

- [x] 4.1 勾选 tasks / 更新 plan
- [x] 4.2 archive
