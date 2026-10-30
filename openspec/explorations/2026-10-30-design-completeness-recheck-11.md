# 概设/详设完整性复核（第十一轮，2026-10-30，只读）

## 范围

基准：概设 V1.16、详设 V1.9。本轮核对 **M11 监控能力**、**详设 §7 定时任务**、**概设 §8.3/M11 接口清单完整性**，并抽查 ADR A5–A14 落地情况。

## 结论

ADR A5–A14 全部落地（Redis fail-open、compose、每租户独立实例、Ed25519 离线证书、混淆+Rust、增项解耦、导入审核门禁、控制面不存正文、本地模型经 FastGPT、embedding 重建）。发现 **1 项功能缺口（SaaS 资源水位）** 与 **2 处文档不完整**。

## P1 功能缺口：SaaS 监控缺容器资源水位

- 承诺：
  - 概设 M11（:441）：「聚合各实例 `/healthz`、问答失败率、LLM 失败率、**容器资源水位**；租户实例异常自动重启并告警」
  - PRD FR-12：「平台级监控告警（实例存活、**资源水位**、问答失败率、LLM 调用异常）」
- 实际：
  - `health.controller.ts:31-54` 的 `/healthz` 只输出 `license` 与 usage 计数（messagesReceived/Answered/Missed/llmFailures/send*），**无 CPU/内存**。
  - `platform-monitor.ts:14-19` 定义了 `cpuPct?/memPct?`，但 `HttpHealthSource.probe()`（:242-268）只映射 `healthy + qaFailRate + llmFailRate`，两字段**从未赋值**。
  - `GET /platform/usage` 直接返回 `monitor.collect()`，因此实例数组里的资源水位恒为空；`tick()` 只按 `!healthy` 触发重启/告警，无水位阈值。
- 影响：SaaS 运营看不到租户实例资源使用，无法在 OOM/CPU 打满前介入；PRD 验收项「资源水位」缺失。
- 建议：`/healthz` 增加 `resources: { cpuPct, memPct }`（cgroup v2 `memory.max/memory.current` 优先，回退 `os.totalmem`；CPU 用 loadavg/cpu 数或 cgroup cpu.stat 采样）；monitor 映射并在连续 N 次 ≥ 阈值（默认 90%）时推送告警（复用 `OpsAlertService` 冷却）。

## P2 文档不完整：详设 §7 定时任务表缺审计清理

- 代码：`platform-audit.service.ts:62` `@Cron('50 3 * * *')` 每日 03:50 清理 180 天前审计（先导出 JSONL 再删除）。
- 详设 §7 表只有 license 03:00 / miss 03:30 / 导入 03:40 / 到期 09:00 / 用量 02:30 / 备份 02:00，缺 03:50 一行。

## P3 文档不完整：概设接口清单缺已实现端点

- §8.3 适配层缺：`GET /admin/usage`、`POST /admin/config/reload`、`GET /admin/assets/:id`、`POST /admin/import-jobs/from-url`、`POST /:id/parse`、`GET /:id/items`、`POST /:id/approve-all`、`GET /:id/unpaired`、`POST /:id/unpaired/pair`、`DELETE /:id`、`GET /counts`、`POST /lock/release`、`POST /internal/tenant/sync`。
- M11 平台侧缺：`POST /platform/tenants/:id/provision`、`/restart`、`PUT .../secrets`、`POST .../credentials/handoff`、`POST .../shell-access`、`GET /platform/audit-log/verify`、`POST /platform/sweep`、`POST /platform/report`。
- 建议：补全或加一句「完整清单以 Swagger `/docs` 与详设 §6 为准」。

## 已确认无问题

| 项 | 结论 |
|---|---|
| ADR A5–A14 | 逐条有对应实现 |
| 导入配对参数 | `IMPORT_PAIR_GAP_MINUTES=30`、`IMPORT_MIN_ANSWER_CHARS=6` |
| 升级编排 | 金丝雀/批次/快照/回滚 |
| 审计链 | seq + prev_hash + 校验接口 |
| 定时任务其余 6 项 | 与代码一致 |
