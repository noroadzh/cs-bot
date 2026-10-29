# Design

## Context

见 proposal.md。部署手册步骤分散在 §7.1–§7.6、§9，技术支持需要逐条执行；`deploy/` 已有 compose、`init-perms.sh`、`backup.sh`，但无统一入口。

## Goals / Non-Goals

**Goals:**

- 一条命令完成预检、目录、权限、镜像、启动、健康等待与结果输出。
- 失败时给出可直接照做的修复提示，不产生半启动状态。

**Non-Goals:**

- 不替代 compose 或改变服务拓扑；不自动申请 TLS 证书；不自动生成 license。
- 不处理 SaaS 控制面（由 `docker-compose.saas.yml` 单独启动）。

## Decisions

### D1 脚本流程

`deploy/install.sh` 顺序执行：

1. `--check/--dry-run` 解析；`ROOT=脚本上级目录`。
2. 预检：`docker` 与 `docker compose version`；`deploy/docker-compose.yml`；`.env` 存在；必填键非空（`WECHAT_CORP_ID/WECHAT_AGENT_SECRET/WECHAT_AGENT_ID/WECHAT_TOKEN/WECHAT_ENCODING_AES_KEY/FASTGPT_API_KEY`）；`deploy/nginx/certs/fullchain.pem|privkey.pem`；`license/license.lic`；adapter 镜像本地存在或 `images/*.tar` 存在。
3. 目录：`data data/assets data/import logs backup license config`。
4. 权限：`sudo deploy/init-perms.sh`（非 root 时提示；`--skip-perms` 跳过）。
5. 镜像：存在 `images/*.tar` 且本地无镜像时 `docker load`。
6. 启动：`docker compose -f deploy/docker-compose.yml up -d`。
7. 健康：最多 120s 轮询 `https://127.0.0.1/healthz`（`curl -k`），同时检查 `docker compose ps`；失败时输出最近日志并 `exit 1`。
8. 输出：容器状态、访问地址、`docker compose ... logs` 命令。

### D2 参数

- `--check`：只做 1–2 步，返回 0/1，便于技术支持远程自检。
- `--dry-run`：打印将执行的命令，不落盘不启动，用于培训与测试。
- `--skip-perms`：无 sudo 环境使用。

### D3 文档

- 手册 §7 开头新增「7.0 一键部署（推荐）」：上传包 → `cp .env.template .env` 改 6 个必填项 → `sudo ./deploy/install.sh`。
- 新增「服务调用关系图」（ASCII）：nginx → adapter → pg/redis/fastgpt/mongo；SaaS 叠加 control-plane → 租户实例。
- 手工步骤保留为「分步部署」排障参考。

### D4 打包与测试

- `package-delivery.sh` 白名单加 `deploy/install.sh`；包内测试断言存在。
- `install-script.spec.ts`：`bash -n`、`--dry-run` 输出包含 compose 命令且不创建目录、`--check` 在缺 `.env` 时非零并在临时目录提示缺失项。

## Risks / Trade-offs

- [sudo/权限差异] → 提供 `--skip-perms`，并在失败信息中给出 `chown` 提示。
- [健康检查依赖 443 与证书] → `curl -k` 跳过自签校验；同时兼容容器健康状态。
- [脚本与手册漂移] → 测试断言关键字符串，手册仅保留 3 步入口。

## Migration Plan

- 新部署默认用脚本；存量部署重跑脚本只做目录/权限与 `compose up -d`，幂等。
- 回滚：手工步骤仍可用。

## Verification

- `bash -n deploy/install.sh`；`./deploy/install.sh --dry-run` 输出 6 服务启动命令且不落盘。
- `./deploy/install.sh --check` 在缺少 `.env`/证书/license 时非零并列出缺失项。
- 单测/集成/验收全绿。
