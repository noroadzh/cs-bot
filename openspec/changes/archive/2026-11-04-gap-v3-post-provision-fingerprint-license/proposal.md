## Why

开通时常用全局/占位指纹签发；实例起来后真实机器指纹未自动回采重签，导致 license 与实例绑定不闭环。

## What Changes

- 数据面 `GET /internal/instance/fingerprint`（internal token）
- 开通健康探测后：回采指纹 → 更新 `tenant.fingerprint` → 重签并下发 → reload
- 失败：租户可仍 `active`，标记 `fingerprintPending`，提供运营重试 API
- 不削弱验签/指纹/反回放；`USE_MOCK_LICENSE` 语义不变

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `tenant-provisioning`: 开通后异步指纹回采与 license 重签
- `license-bind` 或沿用 `tenant-registry` 续期契约：重签/热加载行为（以 tenant-provisioning 为主，license 热加载对齐现有 admin reload）

## Impact

- 代码：`platform/tenant.service`、`internal/`、license issuer 调用链
- 非目标：私有化手动签发 CLI 主路径替换；削弱 native 校验
