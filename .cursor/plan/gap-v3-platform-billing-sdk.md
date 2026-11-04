# gap-v3-platform-billing-sdk（施工单）

- **OpenSpec**: `openspec/changes/gap-v3-platform-billing-sdk/`
- **状态**: 已完成 apply
- **测试**: `pnpm -C apps/adapter test platform-billing.spec.ts`；`pnpm -C apps/admin-web exec vitest run src/pages/platform/BillingPage.test.tsx`

## 顺序

1. PaymentProvider + 预下单 ✅  
2. webhook 幂等 markPaid ✅  
3. 自助 UI ✅  
4. 勾选 tasks / 差距表 ✅

## 接线清单（adapter-foundation）

- 无：`PlatformModule` 已注册 `SelfServeWebhooksController`；控制面镜像沿用 `control-plane-main.js`。

## 差距表（支付）

- 真实微信/支付宝 SDK 预下单与平台验签仍为占位 HMAC；生产接入时在 `platform/billing/payment-provider.ts` 替换 TODO。
