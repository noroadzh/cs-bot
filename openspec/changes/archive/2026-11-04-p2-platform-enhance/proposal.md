# Proposal

## Why

差距表 P2 平台增强仍为缺口或注册 API 占位：GPU/vLLM 无健康探测与调度、LoRA 无训练编排、无 Prometheus 刮取面、SaaS 通配证书 + SNI 未全自动。不补齐则无法按概设 M11/运维面宣称平台增强可验收。

## What Changes

- GPU/vLLM：目录条目健康探测；按健康结果参与调度/选路后端（仍不在消息热路径上跑训练）
- LoRA：训练任务登记、状态流转与完成回调编排（禁止占用问答热路径）
- Prometheus：适配层/控制面可刮取的 metrics 端点（与现有 `/healthz` 并存）
- SaaS TLS：通配证书 + 租户 SNI 自动签发/挂载路径可验收（在现有 CertificateProvider 之上）
- **非本 change**：真实云厂商 GPU 账单、完整 k8s operator、改企微热路径

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-model-routing`: GPU cluster / fine-tune — 健康探测、调度与训练任务编排
- `observability-logging`: 增加 Prometheus metrics 导出要求
- `tenant-provisioning`: TLS — 通配 + SNI 自动签发与挂载

## Impact

- `platform/gpu-catalog*`、`ModelRouterService`、`certificate-provider`、`shell-provisioner` nginx/SNI
- 新增 metrics 模块（建议 `health/` 或 `common/metrics`，foundation 接线）
- 施工单：`.cursor/plan/p2-platform-enhance.md`
- 前置：`p1-ops-learning-asr` 已实现完成，**建议先归档 P1 再 apply P2**（可并行规划）
