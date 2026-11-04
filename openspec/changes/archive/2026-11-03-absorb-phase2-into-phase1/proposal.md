# Proposal: 原二期能力并入一期

## Why

商务与产品确认不再保留「二期」分期：原 PRD §3.2 / 报价单第五节能力全部纳入一期交付。文档与实现须统一口径；微信个人号因无官方合规通道永久排除。

## What Changes

- 文档：PRD、概设、详设、报价单、建议书、部署/用户手册、文档清单去掉「属二期 / 不在本期」表述，改为一期范围 + 永久排除。
- 规格：为看板/RBAC/知识代理、多模态与会话存档、学习闭环、自助计费与共享租户、GPU 路由与微调增加或扩展 Requirement。
- 实现：先闭环现有缺口（019、Redis、license、miss status），再按工作流落地新能力。

## Capabilities

### New Capabilities

- （随实现落地后同步到主 specs；本 change 以 delta 修改现有能力为主）

### Modified Capabilities

- `admin-console` / 运营面：角色分级、数据看板、知识代理页
- `miss-record`：status 更新与一键补录
- `media-recognition`：语音/视频解析、图片闲聊
- `import-pipeline`：会话存档实时接入、零审核可选
- `tenant-registry`：自助注册、支付、按量、shared 租户
- `local-model-routing`：多模型路由、集群、微调注册
- `license-bind`：mock 闸门与实例指纹签发语义

## Impact

- 范围扩大，商务需另签变更；技术栈仍守 R-1～R-8（知识页经 FastGPTClient，不直连向量库）。
- 客户部署包仍不含签发工具与私钥。
- 永久排除：微信个人号。
