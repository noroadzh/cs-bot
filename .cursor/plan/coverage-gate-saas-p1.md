# coverage-gate-saas-p1

- **OpenSpec**: `openspec/changes/archive/2026-11-10-coverage-gate-saas-p1/`
- **权威 Scenario**: P1 三文件纳入门禁
- **状态**: 已验证归档

## 验证（已通过）

```bash
pnpm -C apps/adapter test:cov
# 131 suites / 1125 tests；global ~88/72/84/89
# fastgpt-qa.engine ~87/63；import-job ~79/73；platform.controller ~99/70
```

## 变更摘要

- 去掉三文件 `collectCoverageFrom` 排除
- 单文件阈值：行/语句/函数 ≥60%，分支 ≥50%
- 补 platform 控制器全动作、import startParse/confirm/惰性 client、engine router/probe 分支
