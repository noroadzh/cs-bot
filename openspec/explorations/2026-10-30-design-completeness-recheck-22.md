# 概设/详设完整性复核（第二十二轮，2026-10-30，只读）

## 范围

基准：概设 V1.26、详设 V1.15。本轮核对 **M11 开通编排实现** 与 **详设 §3.9 资源保护（R-8）表述**。

## 结论

开通编排与设计一致（render → seed → 证书 → 授权 → up → 探活 → 失败保留现场并置 failed）。发现 **1 处 R-8 表述与实现不符（P2 文档）**。

## P2 详设 §3.9 资源保护表述

- 文档：「进程内 **BullMQ-lite**（单消费者）；批 2000 条间检查 `rss > 0.8*limit` → **暂挂 5min**」。
- 实际：
  - 队列为自研 `ImportTaskQueue`（进程内 FIFO + 单消费者标志），**未依赖 BullMQ**；
  - `guardMemory()` 在每批处理后调用，超阈值时**每 5 秒轮询**内存，降回阈值以下立即继续（不是固定暫挂 5 分钟）；
  - 阈值同时考虑「增量 >200MB」或「RSS > 80% 配置限额」（`import-memory.ts`）。
- 建议：改为「进程内 `ImportTaskQueue`（单消费者）；每批后检查增量 >200MB 或 RSS >80% 限额，超阈值每 5s 轮询、恢复后继续」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| 开通编排顺序 | render → seed（DB/管理员口令）→ TLS 证书 → 订阅授权 → compose up → 探活 |
| 失败处理 | down（保留卷）+ `provisioning_failed` + 审计 |
| 端口分配 | `tenant_port_seq` 30000 步长 10 |
| 密钥 | `TenantSecretsService.ensure` 加密存储，缺必填项 `TENANT_SECRETS_MISSING` |
| 授权签发 | `ShellLicenseIssuer` 绑定 `PLATFORM_LICENSE_FINGERPRINT` 与到期日 |
