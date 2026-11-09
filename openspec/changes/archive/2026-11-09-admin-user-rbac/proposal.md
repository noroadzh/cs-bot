# Proposal

## Why

运营台与 SaaS 控制面目前仅靠环境变量双账号（admin/operator）登录，多人共用口令无法追责。需要改为数据库用户表 + 可扩展角色，并对每一次管理接口调用落审计，使操作可定位到具体人。

## What Changes

- 新增管理用户/角色持久化与用户管理 API（租户 `/admin/*` 与控制面 `/platform/*` 对称）
- **BREAKING**：登录只认库用户；`ADMIN_USER` / `ADMIN_PASSWORD` / `ADMIN_OPERATOR_*` 不再作为有效登录凭据
- `deploy/setup.sh`（及控制面安装步骤）引导创建首个 `admin` 用户；升级场景提供 bootstrap 脚本
- 角色先内置 `admin` / `operator`，角色存表，后续可新增角色而不改登录模型
- **每一次**管理 API 调用写入请求级审计日志（含用户名、角色、方法、路径、状态、耗时、IP）；不记录口令与敏感正文
- admin-web 增加用户管理与审计查询页；菜单按角色收敛
- 平台既有链式 `platform-audit`（危险变更 + reason）保留；本变更另增请求级操作审计，不替代链式审计

## Capabilities

### New Capabilities

- `admin-identity`: 管理用户、角色、密码哈希校验、用户 CRUD、首用户引导与库用户 Basic Auth

### Modified Capabilities

- `admin-api`: Basic Auth 从 env 双账号改为库用户；IP 白名单保留；增加用户与请求审计查询端点
- `admin-console`: 登录与角色文案对齐库用户；用户/审计页
- `platform-audit`: 补充控制面请求级操作审计要求（与现有 mutation 链式审计并存）
- `deployment-suite`: setup 引导首用户；部署包/迁移包含用户与审计 DDL；升级 bootstrap

## Impact

- 代码：`apps/adapter/src/admin/*`、`platform/platform.controller` 鉴权链、控制面 Guard、`deploy/setup.sh`、compose/Dockerfile 迁移挂载、`apps/admin-web`
- 配置：**BREAKING** 依赖 env 口令的现网实例升级前必须 bootstrap 库用户，否则无法登录
- 非目标（本 change 明确不做）：OAuth/SSO、细粒度权限点矩阵、跨租户实例统一身份联邦
- 施工单：`.cursor/plan/admin-user-rbac.md`
