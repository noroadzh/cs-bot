## 1. 规格与施工单

- [x] 1.1 确认 proposal/design/delta 与差距表 P2 对齐
- [x] 1.2 维护 `.cursor/plan/p2-platform-enhance.md`；注明 P1 归档建议

## 2. GPU 健康与调度

- [x] 2.1 端点健康探测（调度/缓存）+ 失败阈值
- [x] 2.2 `ModelRouter.pick` 跳过 unhealthy
- [x] 2.3 单测：不健康端点不被选中

## 3. LoRA 训练编排

- [x] 3.1 控制面 `finetune_job` 持久化与 create/list/status API
- [x] 3.2 complete 回调登记 catalog（保持不进热路径）
- [x] 3.3 单测：状态机与 complete → register

## 4. Prometheus

- [x] 4.1 `METRICS_ENABLED` + `/metrics` text exposition
- [x] 4.2 访问限制（CIDR/内部）与 access log 降噪
- [x] 4.3 单测：开启时返回系列；关闭时不可用

## 5. 通配 TLS + SNI

- [x] 5.1 `PLATFORM_TLS_MODE=wildcard|dedicated` 与 provider/挂载路径
- [x] 5.2 provision 写 SNI server + 共用通配证书；失败回滚
- [x] 5.3 单测或 provisioner 夹具覆盖 wildcard 路径

## 6. 验证

- [x] 6.1 adapter 相关单测通过
- [x] 6.2 更新差距表 P2 勾选状态
