## Why

自助计费已有订单持久化与 mock 支付；真实微信/支付宝预下单与 webhook 结算未接，SaaS 自助无法生产收款。

## What Changes

- 配置渠道密钥后，`channel=wechat|alipay` 返回预下单参数，**不得**在下单时 markPaid
- 验签 webhook → 幂等 `BillingService.markPaid` → renew + 审计
- 无密钥时保持 mock/`POST .../pay` 沙箱
- 平台/公开面自助 UI：`/register`、`/billing`、订单轮询与「模拟支付」

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `tenant-registry`: Self-serve billing 从「SDK optional」收紧为可配置真实渠道
- `platform-audit`: 补充 billing webhook / pay 审计类型（若尚未覆盖）
- `admin-console`: 自助计费页（平台 surface）

## Impact

- 代码：`platform/billing`、self-serve controller、webhook、admin-web 平台包
- 非目标：云账单、发票税务、单进程 ALS
