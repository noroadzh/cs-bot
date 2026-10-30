# Tasks

## 1. FastGPT 后台入口

- [x] 1.1 nginx.conf 增加 8443 server（反代 fastgpt:3000，include 白名单文件）。
- [x] 1.2 新增默认 `deploy/nginx/fastgpt-admin-allow.conf`（`deny all;`）。
- [x] 1.3 compose nginx 暴露 `${FASTGPT_ADMIN_PORT:-8443}:8443` 并挂载白名单文件。
- [x] 1.4 `install.sh` 生成白名单（`FASTGPT_ADMIN_ALLOW_CIDRS`），校验 CIDR，dry-run 打印。
- [x] 1.5 `.env.template` / `deploy/.env.template` 增加 `FASTGPT_ADMIN_PORT`、`FASTGPT_ADMIN_ALLOW_CIDRS`。

## 2. 测试与打包

- [x] 2.1 `deploy-runtime.spec.ts` 断言 8443 server、include、compose 端口、默认 deny。
- [x] 2.2 `install-script.spec.ts` 断言 dry-run 含白名单生成；`package-delivery.spec.ts` 断言包内含白名单文件。

## 3. 文档

- [x] 3.1 详设 §1.4/§1.5/§1.6 契约改为实际。
- [x] 3.2 概设 §10.1 端口矩阵补 8443；部署手册与私有化用户手册补入口步骤。

## 4. 验证

- [x] 4.1 `docker compose config` 通过；全量单测/集成/验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify add-fastgpt-admin-proxy`，通过后 `/opsx:archive`。
