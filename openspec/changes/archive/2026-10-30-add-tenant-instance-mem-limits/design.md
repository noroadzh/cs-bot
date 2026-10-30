# Design

## Context

见 proposal.md。基线私有化 `deploy/docker-compose.yml` 已有 6 个 `mem_limit`（合计 ≈5.9G）；租户模板由 `ShellProvisioner.render()` 以字符串数组生成，漏了限额。

## Goals / Non-Goals

**Goals:**

- 租户实例与私有化基线同等内存隔离，OOM 不跨租户扩散。
- 限额值可解释（对应 §10.5 standard 档）。

**Non-Goals:**

- 不做 CPU 硬限（与基线一致；CPU 争抢由调度器与限流承担）。
- 不实现 enhanced 档（8C16G）自动切换——模板注释说明后续按档位调参即可。
- 不改配额/计量逻辑。

## Decisions

### D1 限额值（standard 档 = 私有化基线）

| 服务 | mem_limit |
|---|---|
| nginx | 128m |
| adapter | 512m |
| fastgpt | 2560m |
| pg | 1229m |
| mongo | 1024m |
| redis | 512m |

合计 ≈5.9G ≤ 6.5G 预算；与 `deploy/docker-compose.yml` 完全一致，便于运维用同一套容量口径。

### D2 渲染位置

在每个服务名后紧跟 `mem_limit`，并在文件头注释「资源硬隔离（概设 §10.5 standard 档）；enhanced 档另行调整模板」。

### D3 测试

`shell-provisioner.spec.ts` 渲染用例断言：6 个 `mem_limit` 行、合计 ≤6500m。

### D4 文档

概设 §10.5 在「每租户实例规格」后补一句「租户 compose 已写入 standard 档 mem_limit（合计 ≈5.9G）」；§12 风险 8 应对措辞与实现一致。

## Risks / Trade-offs

- [FastGPT 2.5G 对 enhanced 档偏紧] → enhanced 档需另调模板（已在注释与文档说明），不影响本期 standard。
- [限额过紧导致租户 OOMKill] → 与私有化基线一致；导入已有 200MB 增量守卫。

## Migration Plan

- 新开通租户直接生效；存量租户需重新 `render` + `up -d`（或 `restart`）才应用限额。
- 回滚：移除 `mem_limit` 行即可。

## Verification

- `shell-provisioner.spec.ts` 断言限额数量与总额。
- 全量单测/集成/验收通过。
