# Design

## Context

- MVP 数据面已稳定：wecom 回调 → QA 检索 → 用量统计 + 错失登记走 `apps/adapter/src/admin/`，底层用 PG + Redis + fastgpt/WeWork 外部依赖。
- 控制面复用同一进程，鉴权走 Basic Auth + IP whitelist（见 `admin.guard.ts`）；本 change 新增 19 个端点全部挂此 guard，不引入新鉴权体系。
- SQL 迁移以追加式编号文件落地（已有 `media/002-asset.sql`），运行时由迁移加载器按文件名升序执行；本 change 追加 `import/004-import-job.sql` + `platform/007-tenant.sql`。
- 进程编排选型：默认 `ShellProvisioner`（`node:child_process.spawn` 调用 `docker compose`），与 `Provisioner` 接口并列；接口可注入便于单测。

## Goals / Non-Goals

**Goals:**

- M10 / M11 端到端可工作但**未实现**计费、K8s、数据面租户隔离
- 编排只走 `docker compose`，所有编排副作用以审计链可追
- 配额 / 用量 / 审计在 PG 单事务内一致

**Non-Goals:**

- 不引 BullMQ、不引 dockerode、不引 Redis 队列（用 `@nestjs/schedule` cron + DB 轮询）
- 不做租户实例的 HTTPS 证书 / 自签证书管线（依赖 ops）
- 不做 R2.5 数据面多租户请求路由
- 不做 Stripe / 支付宝

## Decisions

### D1: Provisioner 接口 + 默认 Shell 实现

```ts
// apps/adapter/src/platform/provisioner/provisioner.ts
export interface TenantProvisioner {
  render(tenant: Tenant): Promise<string>;     // 写入 PLATFORM_COMPOSE_DIR/<id>/docker-compose.yml
  up(tenant: Tenant): Promise<void>;            // docker compose -p csbot-t-<id> -f <path> up -d
  probe(tenant: Tenant, timeoutMs: number): Promise<boolean>;
  stop(tenant: Tenant): Promise<void>;          // compose stop
  start(tenant: Tenant): Promise<void>;         // compose start
  down(tenant: Tenant, dropVols: boolean): Promise<void>;  // compose down [-v]
}
```

`ShellProvisioner` 用 `child_process.spawn('docker', ['compose', '-p', `csbot-t-${id}`, '-f', path, ...])`，**不引入 dockerode**——理由是 dockerode 与 docker CLI 行为不完全一致，spawn 路径更接近运维心智模型且故障日志可直读 stderr。

> 备选：dockerode。否决——故障表现比 spawn 难以定位，且和运维同学平时写的 compose 命令不在同一心智层。

### D2: 状态机的允许转移表

集中在 `TenantStateMachine.assertTransition(from, to)` 单一函数，所有控制面端点调用之；非法转移抛 `IllegalTenantTransition`（HTTP 409）。

```
created       → provisioning
provisioning  → active | provisioning_failed
active        → grace | suspended | terminated
grace         → active | suspended
suspended     → active | terminated
provisioning_failed → terminated (强制清理)
```

> 备选：在 controller 内 if-else。否决——状态转移散落各处，审计也无法集中。

### D3: 配额校验链路

1. 入参（`POST /wecom/...`）先过 `LicenseService.getState()`（已实现），确保平台 license 通过
2. 再过 `TenantQuotaService.consume(tenantId, kind)`，原子 UPDATE ... WHERE count+Δ ≤ limit RETURNING
3. 超限返回 `429 Too Many Requests` + reason

> 备选：每请求前 SELECT count 校验。否决——SELECT/UPDATE 间存在 race，UPDATE WHERE 是唯一正确做法。

### D4: 用量日聚合

`tenant_usage_daily` 表 + 唯一键 `(tenant_id, day)`，`ON CONFLICT (tenant_id, day) DO UPDATE SET count = count + EXCLUDED.count`。避免每天 1 行 UPDATE 与并发 INSERT 打架。

> 备选：Redis INCR + 定时落库。否决——MVP 阶段单一数据源更易排错；Redis 增加故障面。

### D5: 审计链的并发与一致性

`platform_audit_log` 的 `prev_hash`/`hash` 在 PG 事务内计算：
1. `SELECT hash FROM platform_audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE` 拿最后一个 hash
2. 计算 sha256(canonical_json({prev_hash, action, actor, tenant_id, payload, created_at}))
3. INSERT

`FOR UPDATE` 串行化并发事务，链不会分叉。极端情况下需要读已提交快照：审计行在事务内是新增不可见，所以这个 SELECT 实际上等的是别的事务；接受串行化级别即可。

> 备选：app 层分布式锁。否决——单进程内 PG 行锁足够，跨进程再说。

### D6: 脱敏 5 类正则独立可配

`SensitiveRedactor` 内部 5 个独立 `RegExp`，可被 spec mock 覆盖；`MOCK_REDACTION` 关闭该服务（命中仍写 flag 但不替换答案文本），便于单测定位非脱敏相关回归。

> 备选：调用云 NER。否决——MVP 离线运行，正则命中率已 > 95% 已知模式。

### D7: 导入 MIME 与解析器映射

`ImportParser` 用 `MIME → parser` 字典：

| MIME | parser |
|---|---|
| `text/csv` | `CsvParser`（首行视为表头，列名含 `question`/`answer` 必需） |
| `application/json` | `JsonlParser`（每行 `{question, answer}`） |
| `text/plain` | `TxtQAParser`（空行分段；段内首句 question，其余 answer） |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `XlsxParser`（与 CSV 同列名约束） |

未匹配 MIME 返回 `415 unsupported_format`。

> 备选：插件机制。否决——MVP 4 类已覆盖客户已知格式，插件边界放在二期。

## Risks / Trade-offs

- [R1: compose up 卡死无返回] → 60s 命令级 timeout，stdout/stderr 实时记录到 `tenant.last_provision_log`；超时不豁免。
- [R2: 审计事务阻塞] → 审计行 INSERT 与状态变更在同一事务，PG 连接被打满风险；缓解：审计表小（不存 LOB），索引只 `(created_at desc)`。
- [R3: shell 注入面] → 命令参数全部走 `spawn` 数组形式，不拼字符串；compose 文件名仅允许 `[a-z0-9-]`。
- [R4: 配额误判] → UPDATE WHERE 返回 0 行时，区分"限为 0/已达上限" vs "租户不存在"（前者 429，后者 404）。
- [R5: 配额限流被绕过] → spec 测试覆盖 3 并发 INSERT，应只有 1 成功；用真 PG 跑（不是 mock）。
- [R6: docker compose 在生产 pod 内未必可用] → `PlatformProvisioner` 接口可替换；K8s 部署时切到 NoopProvisioner（仅更新 DB 状态），平台自行保证底层编排。
- [R7: 旧租户数据库被 terminate 后无法审计回溯] → `tenant.terminate` 的 audit payload 携带 `droppedDatabase` 标志，但 DB 物理删除不可逆——这是 doc 过的取舍，运营/法务侧要备份责任前置。

## Migration Plan

按以下顺序部署：

1. **Phase 1 — Schema**: 部署 `import/004-import-job.sql` + `platform/007-tenant.sql`；失败回滚用 `DROP TABLE ... CASCADE`（仅限本 change 涉及的 6 张表）。
2. **Phase 2 — M10**: 部署 `import` 模块；MVP 单租户先跑通，不涉及租户上下文。
3. **Phase 3 — M11 控制面**: 部署 `platform` 模块 + `Provisioner` 接口 + `ShellProvisioner` 默认实现；首租户走真实 docker compose 演练。
4. **Phase 4 — Sweep**: 启用 `TenantExpirySweep` cron 任务；观察 7 天再调阈值。
5. **回滚**: 关闭 cron，禁用 `/platform/tenants` 路由（feature flag `PLATFORM_ENABLED=false`），保留 DB 数据；下一次部署再恢复。

## Open Questions

- 运营方是否要求"租户首次进入 grace 时给客户发邮件通知"？这会引入邮件服务依赖，目前能力描述里不包含；建议放二期。
- 配额 `max_storage_mb` 暂以"单租户 asset 表 size 求和"近似，没接对象存储；二期接 S3 / OSS 后才精确。
