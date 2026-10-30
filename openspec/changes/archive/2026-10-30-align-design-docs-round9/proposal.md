# Proposal

## Why

第九轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-9.md`）发现：部署手册附录 A 要求客户在「租户管理页」填写密钥，但管理面是纯 API、无该页面，客户按手册无法完成 SaaS 开通；概设 §7.4 平台侧表与实际迁移严重不符（缺列/列名不同/类型不同）；详设 §2.4 license-native 签名与 `.d.ts` 不符；§3.8 启动校验位置描述不准。

## What Changes

- **部署手册附录 A**：第 3 步改为「客户经约定安全渠道提供企微/LLM 凭据，平台运营经 `PUT /platform/tenants/:id/secrets` 写入」，并注明管理页面属二期。
- **概设 §7.4**：按 `007/011/012/015/016/017` 迁移重写四张平台侧表，补充升级/快照/注销相关表清单，注明「以迁移为准」。
- **详设 §2.4**：`license-native` 接口按 `index.d.ts` 重写（`verify/antireplay/selfcheck/fingerprint` 的返回结构体）。
- **详设 §3.8**：启动校验位置改为 `AppModule.onModuleInit`（Nest 初始化期，早于 HTTP listen）。
- 版本：概设 V1.15、详设 V1.8、部署手册 V1.11；文档清单与引用同步。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：部署手册、概设、详设、文档清单、用户手册与测试报告版本引用。
- **代码/规格/测试**：无改动。
