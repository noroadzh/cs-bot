# Tasks

## 1. 一键部署脚本

- [x] 1.1 新增 `deploy/install.sh`：预检（docker/compose/.env 必填/证书/license/镜像）、目录、权限、镜像加载、compose 启动、健康等待、结果输出。
- [x] 1.2 支持 `--check`、`--dry-run`、`--skip-perms`，重复执行幂等，且只启动基线 6 服务。

## 2. 打包与测试

- [x] 2.1 `scripts/package-delivery.sh` 白名单加入 `deploy/install.sh`；`package-delivery.spec.ts` 断言产物含该脚本。
- [x] 2.2 新增 `install-script.spec.ts`：语法、`--dry-run` 不落盘、`--check` 缺项非零；`deploy-runtime.spec.ts` 断言脚本存在与关键命令。

## 3. 文档

- [x] 3.1 部署手册新增「7.0 一键部署（推荐）」3 步入口。
- [x] 3.2 部署手册新增服务调用关系图（基线 + SaaS 叠加）。

## 4. 验证

- [x] 4.1 本地执行 `--dry-run`/`--check` 验证行为；单测、集成、验收通过。

## Workflow follow-up

- 完成后 `/opsx:verify add-one-click-deploy`，通过后 `/opsx:archive`。
