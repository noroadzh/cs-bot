## Context

开通优先 env/占位指纹；实例真实指纹回采未闭环。

## Goals / Non-Goals

**Goals:** internal 指纹探针、开通后重签、运营重试。  
**Non-Goals:** 削弱 native；替换私有化 CLI 签发。

## Decisions

1. 数据面 `GET /internal/instance/fingerprint` 调 native `fingerprint()`。
2. 控制面 post-health hook：collect → update → issue → deploy → reload。
3. 失败标记 pending，不降级为无绑定 license。

## Risks / Trade-offs

- 时序竞态 → 重试幂等（指纹不变则跳过）。
- 网络分区 → 审计 `license.reissue_failed`。

## Migration Plan

已有租户可手动 `collect-fingerprint`；新开通自动尝试。
