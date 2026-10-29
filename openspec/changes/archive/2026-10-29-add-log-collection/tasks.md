# Tasks

- [x] 1.1 新增 `deploy/collect-logs.sh`（容器日志 + 落盘日志 + 环境信息 → tar.gz，600 权限）。
- [x] 1.2 支持 `--since`、`--out`、`--dry-run`。
- [x] 2.1 部署手册 §10.1 重写为日志定位/查看/下载，并在 §9.1 加快捷入口。
- [x] 2.2 打包白名单纳入脚本；新增/更新测试。
- [x] 3.1 手册升 V1.6，文档清单与测试报告引用同步。
- [x] 4.1 脚本 `--dry-run` 本地验证；单测通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify add-log-collection`，通过后 `/opsx:archive`。
