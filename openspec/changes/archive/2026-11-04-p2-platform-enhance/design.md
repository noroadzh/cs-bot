# Design

## Context

现有：`GpuCatalogController` 仅 register / finetune complete；证书有 Fake/File/Command provider；无 `/metrics`；nginx 每租户独立证书目录，通配+SNI 未产品化。

## Goals / Non-Goals

**Goals**

- 注册的 vLLM 端点可探测健康，不健康不进入选路候选（或降权）
- LoRA 任务有独立状态机 API；complete 仍登记目录；训练 worker 异步、不进 wecom→qa 热路径
- Prometheus text exposition（至少进程存活、管道计数、租户/授权闸门粗指标）
- 通配证书模式下开通租户自动 SNI server 块 + 证书引用，失败可回滚

**Non-Goals**

- 自建完整 GPU 集群调度器 / k8s CRD
- 替换 Let's Encrypt 私有化单域脚本（已有）；P2 聚焦 SaaS 通配+SNI
- 改 R-1～R-8 热路径依赖方向

## Decisions

1. **健康探测**：控制面或平台定时 HTTP GET 端点 `/health` 或配置的 probePath；结果缓存到 catalog；`ModelRouter.pick` 跳过 unhealthy。
2. **训练编排**：`finetune_job` 表（控制面 PG）状态 `queued|running|succeeded|failed`；API 创建/查询；complete 回调写 artifact 并 register；消息路径禁止调用训练。
3. **Metrics**：`GET /metrics`（可单独端口或同进程；默认需 IP 白名单或内部网）；prom-client 或手写 text；不在 access log 刷屏。
4. **通配+SNI**：新增 `WildcardSniCertificateProvider`（或扩展 Command）：签发 `*.saas.example` 一次，provision 写 nginx `server_name` + ssl_certificate 共用通配路径；专用子域模式保持现有 per-tenant 文件。

## Risks / Trade-offs

- ffmpeg/GPU 节点网络不稳定：探测失败要有 hysteresis，避免抖选取路。
- `/metrics` 泄露用量：必须鉴权或 CIDR；文档写明。
- 通配 DNS 与 ACME DNS-01 运维复杂度：Command provider 外包给现有 `PLATFORM_CERT_CMD`。

## Migration Plan

配置开关：`PLATFORM_TLS_MODE=dedicated|wildcard`；默认 dedicated 兼容现状。Metrics 默认关闭或仅 loopback，显式 `METRICS_ENABLED=true` 开启。
