# Proposal

## Why

私有化交付包与内部 SaaS 部署共用同一份 `deploy/docker-compose.yml`：它默认定义并启动 `control-plane`，还挂载 `tools/license-issuer`（交付方签发工具）与 `/var/run/docker.sock`。客户按部署手册执行 `docker compose up -d` 会连带拿到平台控制面、签发工具路径与宿主 Docker 访问能力，违反概设 M9「私钥与签发工具仅存交付方」和详设 §8「控制面镜像仅 SaaS 形态交付」的授权边界；同时交付包目前靠人工挑选文件，无法保证内部制品不会混入。

## What Changes

- **BREAKING（仅内部部署命令）**：基线 `deploy/docker-compose.yml` 收敛为 6 个单租户服务（adapter/fastgpt/pg/mongo/redis/nginx），不再包含 `control-plane`；控制面拆到新增的 `deploy/docker-compose.saas.yml`，SaaS 部署以 `docker compose -f docker-compose.yml -f docker-compose.saas.yml up -d` 叠加启动。
- `deploy/docker-compose.control-plane-expose.yml` 改为在 SaaS 叠加文件基础上追加管理网段端口绑定。
- 新增 `scripts/package-delivery.sh`：按白名单生成客户部署包（compose、nginx 配置、config 出厂文件、.env 模板、镜像 tar 或 registry 引用、SHA256SUMS），自动排除源码、`tools/`、签发私钥、SaaS 叠加文件、本地 TLS 私钥、`license/license.lic`、`data/`、`logs/`；一旦发现内部制品进入包内即失败。
- 部署手册区分两类打包：客户私有化部署包（形态 A）与内部 SaaS 部署（形态 B，含控制面与签发密钥）；说明 `deploy/nginx/certs` 与 `license/` 由客户证书/交付方签发文件按环境替换。
- 更新 `deploy-runtime` 断言与 `scripts/check-migrations.sh` 的 compose 目标，覆盖基线与 SaaS 两份编排。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：基线 compose 仅 6 服务、控制面通过 SaaS 叠加文件启用；新增「客户交付包内容边界」要求。

## Impact

- **文件**：`deploy/docker-compose.yml`、`deploy/docker-compose.saas.yml`（新）、`deploy/docker-compose.control-plane-expose.yml`、`scripts/package-delivery.sh`（新）、`scripts/check-migrations.sh`、部署手册、`deploy-runtime`/打包测试。
- **行为**：私有化 `docker compose up -d` 不再启动控制面；SaaS 部署命令改为叠加 `docker-compose.saas.yml`（内部变更）。
- **安全**：客户部署不再引用签发工具路径，也不再挂载宿主 Docker socket。
