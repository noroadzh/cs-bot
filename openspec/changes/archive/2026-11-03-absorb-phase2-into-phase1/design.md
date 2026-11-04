# Design: 一期全量

## Decisions

1. **文档先于大功能**：W0 改齐口径后再扩代码，避免规格与手册仍写「二期」。
2. **知识页代理 FastGPT**：不自建向量库（R-2/R-7）；`/admin/knowledge/*` 转发数据集 API。
3. **共享租户**：`tenancy_mode=dedicated|shared`；shared 用 `tenant_id` 逻辑隔离，默认新建仍可用 dedicated。
4. **零审核学习**：默认关闭；开启后低风险自动入库并审计。
5. **支付**：控制面 env 配置微信/支付宝商户；续费调用现有 renew。
6. **微信个人号**：永久排除，文档与规格均不实现。

## Gaps first (W1)

019 挂载、Redis requirepass/healthcheck、pubkey 构建注入、native fingerprint 绑定、mock 闸门不绕过格式/指纹、SaaS 按实例指纹签发、miss status PATCH。
