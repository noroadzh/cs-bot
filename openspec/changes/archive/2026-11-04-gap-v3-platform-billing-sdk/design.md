## Context

`billing_order` + mock pay 已有；无真实预下单/webhook。

## Goals / Non-Goals

**Goals:** wechat/alipay adapter、webhook 幂等、自助 UI。  
**Non-Goals:** 发票、分账、数据面直连支付。

## Decisions

1. `PaymentProvider` 接口：mock | wechat | alipay。
2. Webhook 无 Basic Auth，验签+可选 IP；成功走既有 `markPaid`。
3. 密钥仅 env + zod fail-fast。

## Risks / Trade-offs

- 重放 → 订单状态机 + 幂等。
- SDK 版本锁定 → 适配器隔离。

## Migration Plan

无密钥时行为与现网一致（mock）。
