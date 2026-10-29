# Design

## Context

见 proposal.md 与 `openspec/explorations/2026-10-29-delivery-packaging-and-completeness.md`。当前 `deploy/docker-compose.yml` 单文件同时服务私有化与 SaaS：`control-plane` 服务、`tools/license-issuer` 挂载与 `/var/run/docker.sock` 对私有化客户同样生效；交付包靠人工挑选。

## Goals / Non-Goals

**Goals:**

- 私有化客户拿到的编排与制品不包含控制面、签发工具、私钥与宿主 Docker 访问。
- SaaS 侧仍能一键起控制面与签发链路。
- 打包可重复、可校验，内部制品混入即失败。

**Non-Goals:**

- 不改变镜像构建与 HPA/registry 流程。
- 不改变租户实例模板（`PLATFORM_COMPOSE_DIR` 下的每租户 compose）。
- 不引入新的编排系统（仍是 docker compose）。

## Decisions

### D1 用独立 SaaS 叠加文件，而非 compose profiles

- 基线 `deploy/docker-compose.yml` 只保留 6 个服务，删除 `control-plane` 及其卷。
- 新增 `deploy/docker-compose.saas.yml`：定义 `control-plane`（含 `../tools/license-issuer` 挂载、docker.sock、控制面库迁移挂载）。
- `deploy/docker-compose.control-plane-expose.yml` 保持 override 语义：`docker compose -f docker-compose.yml -f docker-compose.saas.yml -f docker-compose.control-plane-expose.yml`。
- 备选 profiles 被否：控制面定义、issuer 路径与卷声明仍留在客户可见文件里，只是“未激活”，无法整份排除。

### D2 白名单打包脚本

- `scripts/package-delivery.sh`：
  - 输入：`VERSION`（必填）、`IMAGE_TAR`（可选）、`OUT_DIR`（默认 `dist-delivery`）。
  - 内容：`deploy/docker-compose.yml`、`deploy/nginx/nginx.conf`、`deploy/` 运维脚本（`init-perms.sh`、`init-control-db.sh`、`backup.sh`、`logrotate.conf`）、`config/` 出厂文件、`apps/adapter/src/**/*.sql` 迁移、`.env.template`、可选镜像 tar。
  - 排除：`tools/`、`*.pem` 私钥、`docker-compose.saas.yml`、`docker-compose.control-plane-expose.yml`、`license/license.lic`、`deploy/nginx/certs/*`、`data/`、`logs/`、源码。
  - 生成 `SHA256SUMS.txt`（含镜像 tar）。
  - 打包后二次扫描：命中禁止清单即删除产物并 `exit 1`，打印命中路径。
- 校验与归档口径和 `scripts/release-sums.sh` 保持一致（`sha256sum` 优先，macOS 用 `shasum -a 256`）。

### D3 文档

- 部署手册 §7.1：部署包内容按 D2 白名单更新，明确证书与 license 由客户/交付方按环境放入。
- §7.5：私有化启动仍是 `docker compose up -d`（6 容器）。
- 附录 A（SaaS）：启动命令改为叠加 `docker-compose.saas.yml`，并说明签发私钥仅存交付方、`LICENSE_ISSUER_KEY` 由内部注入。

### D4 测试

- `deploy-runtime.spec.ts`：断言基线 compose 不含 `control-plane`/`tools/license-issuer`/`docker.sock`；断言 SaaS 叠加文件包含控制面与 issuer 挂载。
- 新增 `package-delivery.spec.ts`：在临时目录跑脚本，断言产物内容、`SHA256SUMS` 存在、禁止路径不出现；构造含 `tools/license-issuer` 的输入时脚本非零退出。
- `scripts/check-migrations.sh` 的 compose 目标改为基线 + SaaS 两份。

## Risks / Trade-offs

- [内部 SaaS 部署忘记叠加文件] → 部署手册与附录 A 更新；控制面缺失时 adapter 的 `CONTROL_PLANE_URL` 只影响上报（缓冲重试）。
- [白名单遗漏客户需要的文件] → 打包测试覆盖清单；脚本把内容打印到 stdout 便于核对。
- [镜像 tar 体积] → 脚本只负责收集，不构建镜像；大文件路径由 `IMAGE_TAR` 指定。
- [已入库的本地证书/mock license 被误发] → 脚本按路径排除并二次扫描，失败即中止。

## Migration Plan

1. 客户私有化：部署包按新白名单重建；`docker compose up -d` 不变（不再起控制面）。
2. 内部 SaaS：启动命令追加 `-f docker-compose.saas.yml`；签发私钥仍放在 `tools/license-issuer/issuer-private.pem`（不入库）。
3. 回滚：旧部署包与新包在服务集合上兼容；如需恢复旧行为，临时使用上一版 compose。

## Verification

- `docker compose -f deploy/docker-compose.yml config --services` 仅 6 个服务。
- 叠加 `docker-compose.saas.yml` 后含 `control-plane`。
- `scripts/package-delivery.sh` 产物不含禁止路径，`SHA256SUMS` 校验通过。
- 单测/集成/验收全绿。
