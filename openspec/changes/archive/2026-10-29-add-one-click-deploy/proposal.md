# Proposal

## Why

技术支持按部署手册落地需要通读长文档并手工执行：建目录、修权限、放置证书/授权、校验 .env、加载镜像、启动 compose、轮询健康检查。步骤多、易漏项，排障时也缺少服务调用关系图。部署应尽量收敛为一条命令。

## What Changes

- 新增 `deploy/install.sh`（一键部署）：
  - 预检 Docker/Compose、`.env`、必填配置、TLS 证书、`license/license.lic`、镜像（本地镜像或 `images/*.tar`）；
  - 自动创建 `data/ logs/ backup/ data/assets/ data/import/` 并校正归属（`init-perms.sh`）；
  - 加载镜像（存在 `images/*.tar` 时）、`docker compose -f deploy/docker-compose.yml up -d`；
  - 轮询 `/healthz`（HTTPS，忽略自签）直到就绪或超时，输出容器状态、访问地址与日志命令；
  - 支持 `--check`（只预检）、`--dry-run`（只打印动作）、`--skip-perms`；可重复执行（幂等）。
- 部署手册新增「一键部署」章节与 **服务调用关系图**（nginx → adapter → pg/redis/fastgpt/mongo；SaaS 叠加控制面），把 3 步快速上手放在安装章节最前。
- `scripts/package-delivery.sh` 白名单纳入 `deploy/install.sh`，交付包可直接执行。
- 测试：`deploy-runtime.spec.ts` 断言脚本存在与关键行为；新增 `install-script.spec.ts` 覆盖 `--check`/`--dry-run`。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：新增「一键安装」要求（预检、幂等、健康等待、仅基线 6 服务）。

## Impact

- **文件**：`deploy/install.sh`（新）、`scripts/package-delivery.sh`、部署手册、`deploy-runtime.spec.ts`、`install-script.spec.ts`（新）。
- **行为**：部署入口从多步手工变为 `sudo ./deploy/install.sh`；不改变 compose 与运行时。
- **兼容**：手工步骤仍保留在手册中，脚本是推荐路径。
