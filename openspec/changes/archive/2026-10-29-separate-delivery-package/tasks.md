# Tasks

## 1. 拆分客户与 SaaS 编排

- [x] 1.1 基线 `deploy/docker-compose.yml` 删除 `control-plane` 服务及其卷/环境，仅保留 6 个服务；验证：`docker compose config --services` 输出 6 项。
- [x] 1.2 新增 `deploy/docker-compose.saas.yml`：`control-plane` 服务、`tools/license-issuer` 挂载、docker.sock；控制面库迁移仍由基线 pg 挂载；验证：叠加后服务集合含 `control-plane`。
- [x] 1.3 更新 `deploy/docker-compose.control-plane-expose.yml` 的使用说明与示例命令（三层叠加）；验证：`docker compose -f … -f … -f … config` 通过。
- [x] 1.4 `scripts/check-migrations.sh` 覆盖基线与 SaaS 两份 compose；验证：脚本通过且缺失挂载可检出。

## 2. 交付打包脚本

- [x] 2.1 新增 `scripts/package-delivery.sh`：白名单收集 + 禁止清单二次扫描 + `SHA256SUMS`；验证：产物内容正确，命中 `tools/`、私钥、`docker-compose.saas.yml`、`license/license.lic` 时非零退出。
- [x] 2.2 新增 `apps/adapter/test/package-delivery.spec.ts` 覆盖成功与拒绝路径。

## 3. 测试与文档

- [x] 3.1 更新 `apps/adapter/test/deploy-runtime.spec.ts`：基线无控制面/issuer/docker.sock；SaaS 叠加含控制面。
- [x] 3.2 部署手册 §7.1 部署包内容、§7.5 启动命令、附录 A SaaS 启动与签发密钥说明。

## 4. 验证

- [x] 4.1 复核 compose 基线/叠加配置与打包脚本产物。
- [x] 4.2 全量单测、集成、验收通过。

## Workflow follow-up

- 完成后 `/opsx:verify separate-delivery-package`，通过后 `/opsx:archive`。
