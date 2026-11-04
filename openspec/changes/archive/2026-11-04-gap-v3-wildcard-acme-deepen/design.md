## Context

P2 WildcardCertificateProvider 读共享材料；签发/续期仍外挂。

## Goals / Non-Goals

**Goals:** DNS-01 签续、平台 renew/status、部署文档。  
**Non-Goals:** 替换私有化单域 LE；改 dedicated 默认。

## Decisions

1. 优先 `PLATFORM_CERT_CMD` / 脚本外包 DNS-01；平台编排触发与状态。
2. 监控过期 → ops 告警。
3. 失败保留未过期旧证。

## Risks / Trade-offs

- DNS API 密钥 → 仅 env。
- 多实例抢续 → 单飞锁。

## Migration Plan

`PLATFORM_TLS_MODE=dedicated` 默认；wildcard 显式开启。
