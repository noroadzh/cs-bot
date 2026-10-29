# Proposal

## Why

部署手册只有零散的 `docker compose logs` 提示，缺少“日志在哪、怎么看、怎么下载（尤其无 SSH 时）”的完整说明；技术支持排障需要逐容器抓日志、拼时间线，手工成本高。

## What Changes

- 新增 `deploy/collect-logs.sh`：一键收集各容器最近日志、落盘日志（adapter/nginx/control-plane）、容器状态与基础环境信息，打包为 `backup/logs-bundle-<时间>.tar.gz`（600 权限）；支持 `--since`、`--out`、`--dry-run`。
- 部署手册 §10.1 重写为「日志定位、查看与下载」：日志清单（位置/容器/保留）、查看命令（tail/follow/grep traceId）、下载方式（一键收集、`docker cp`、宿主机目录、无 SSH 场景）、脱敏与权限注意。
- 交付包白名单纳入 `collect-logs.sh`；新增脚本测试。
- 部署手册升 V1.6；文档清单与测试报告引用同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅运维脚本与文档，`skip_specs: true`。）

## Impact

- **文件**：`deploy/collect-logs.sh`（新）、`scripts/package-delivery.sh`、部署手册、文档清单、测试报告、`deploy-runtime.spec.ts`/新增 `collect-logs.spec.ts`。
- **代码/规格**：无业务代码改动。
