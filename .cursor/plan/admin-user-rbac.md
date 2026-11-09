# 用户表 RBAC + 全量管理审计

> **For agentic workers:** 实现前先读本 plan 与对应 OpenSpec change；按 tasks 勾选推进。行为口径以 openspec 为准。

- **状态**: verify + sync + archive 完成；交付包需在发版时重建
- **OpenSpec**: `openspec/changes/archive/2026-11-09-admin-user-rbac/`
- **对照**: 差距表「用户表 RBAC」已改为完成；保留 OAuth/SSO、权限点矩阵、跨库身份联邦为非目标
- **主规格（预期 delta）**: `admin-api` / `admin-console` / `platform-audit` / `deployment-suite`

## 已确认决策

| 项 | 决定 |
|---|---|
| 目标 | 多人各用各的账号登录；操作可追到人 |
| 范围 | 租户运营台（`/admin/*` + admin-web tenant）**与** SaaS 控制面（`/platform/*` + admin-web platform）一起做 |
| 登录源 | **只认数据库用户**；去掉 env `ADMIN_USER` / `ADMIN_OPERATOR_*` 登录路径 |
| 首用户 | `deploy/setup.sh`（及控制面等价安装步骤）当场设用户名/密码并写入库 |
| 角色 | 先内置 `admin` / `operator`；角色存表，便于后续新增角色 |
| 审计 | **每一次**管理接口调用都记（含读）；不记口令/正文敏感字段 |
| 非目标 | OAuth/SSO；细粒度权限点矩阵；跨租户实例统一身份联邦 |

## 怎么干（文件与顺序）

### 1. 数据模型（数据面 PG + 控制面 PG）

- 新迁移（建议放 `apps/adapter/src/admin/0xx-*.sql` 与 `platform/` 控制面侧对称或共用 DDL）：
  - `admin_role(code, name, …)` — seed `admin` / `operator`
  - `admin_user(id, username, password_hash, role_code, enabled, created_at, …)`
  - `admin_audit_log(id, user_id, username, role_code, method, path, status, cost_ms, client_ip, surface, created_at, …)`
- `deploy/docker-compose.yml` + `Dockerfile.adapter` 挂载新 SQL（沿用 deploy-migrations 门禁）
- 密码：argon2id 或 scrypt（与现有 Node 依赖兼容即可）；禁止明文

### 2. 鉴权改造

- 改 `AdminGuard`（及控制面同等 Guard）：Basic Auth → 查库校验 hash + `enabled`；挂 `req.adminUser` / `req.adminRole`
- 删除/停用 env 双账号比对；`config.schema` 中 `ADMIN_*` 登录相关项降级为可选废弃或移除（setup 不再依赖其登录）
- `RolesGuard` 继续按 `role_code`；`@Roles('admin')` 保持，未来新角色只扩 seed + 注解

### 3. 用户管理 API

- `GET/POST /admin/users`、`PATCH /admin/users/:id`、`POST /admin/users/:id/disable`（仅 `admin`）
- 控制面对称：`/platform/users`（或共用服务双挂路由，design 定一）
- 禁止禁用「库中最后一个 enabled admin」

### 4. 全量审计中间件

- Nest interceptor / middleware：对 `/admin/*`、`/platform/*`（排除 health、静态 console 资源）落库
- 字段：user、role、method、path、query 键名（非值或脱敏）、status、costMs、IP、surface
- 列表：`GET /admin/audit-logs`（admin；operator 只读本账号可选——默认仅 admin 全量）

### 5. 安装向导

- `deploy/setup.sh`：收集首个 admin 用户名/密码；启动后调用内部 bootstrap 或写入 SQL/脚本插入首用户
- 控制面安装文档/脚本同步：无库用户则拒绝登录并提示完成引导
- 升级客户：提供一次性 `scripts/bootstrap-admin-user.sh`（或 setup 子命令）把旧 env 口令迁成首用户（文档写明；运行时登录不再读 env）

### 6. admin-web

- 登录仍走 Basic，但账号来自库用户
- 新增「用户」「审计」页（tenant + platform surface）
- 菜单按角色隐藏危险项（与 `@Roles` 对齐）

### 7. 测试与验收

- 单测：库用户登录成功/失败/禁用；operator 禁入 license reload；审计每请求一条；末 admin 不可禁用
- `deploy-migrations` / `package-delivery` / setup 相关 spec
- 更新 `.cursor/plan/design-gap-matrix.md`：用户表 RBAC 改为完成；非目标列表去掉该项

## 风险

| 风险 | 缓解 |
|---|---|
| 硬切导致已部署实例无法登录 | 交付升级说明 + bootstrap 脚本；setup 强制建首用户 |
| 全量审计写放大 | 异步/批量插入、索引 `(created_at)`、保留期后续可加（本轮可不做清理） |
| 控制面与数据面两套库 | DDL 对称；用户不跨库联邦（非目标） |

## 实现顺序（施工）

1. OpenSpec change 产物齐全并 validate
2. SQL + repository + password hash
3. Guard 切库 + 去掉 env 登录
4. 审计 interceptor + 查询 API
5. 用户 CRUD API
6. setup.sh / bootstrap
7. admin-web 页
8. 单测 + 差距表 + 部署包迁移挂载

## 验收口令

- 仅库用户可登录两端控制台；env 旧账号无效
- setup 可创建首个 admin
- admin 可建 operator；角色表可扩展
- 任意管理 API 调用产生可查询审计行（含用户名）
- 无 OAuth/SSO/权限点矩阵/跨库联邦

## 关联

- OpenSpec change：`openspec/changes/admin-user-rbac/`
- 实现：`admin/024-admin-identity.sql`、`password-hasher.ts`、`admin-identity.service.ts`、`admin-request-audit.service.ts`、`AdminGuard` DB Basic、`UsersPage` / `RequestAuditPage`、`scripts/bootstrap-admin-user.sh`
- 部署：`deploy/setup.sh`、`deploy/docker-compose.yml`、`deploy/Dockerfile.adapter`
