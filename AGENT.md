# cs-bot 项目约束

微信群智能客服。适配层把企业微信群回调接到 FastGPT，并带管理面与 SaaS 控制面。同一代码基支持私有化单实例与 SaaS（每租户独立实例）。

本文件只约束本仓库。用户目录里的 Ruflo / swarm 编排模板不适用于这里的实现、测试和提交。

## 权威顺序

行为冲突时按此顺序取舍，并回报差异，不要静默改口径：

1. `openspec/specs/` 已归档规格（行为契约）
2. `docs/02-需求与设计/概要设计-微信群智能客服机器人MVP.md`（架构规则 R-1～R-8；与详设冲突时以概设为准）
3. `docs/02-需求与设计/详细设计-微信群智能客服机器人MVP.md`（实施细节）
4. 当前代码、`apps/adapter/src/**/NNN-*.sql`、`apps/adapter/jest.config.cjs`

`docs/01-售前与商务/`、PRD、部署手册、两份用户手册可对外。概要设计与详细设计含授权、加固、控制面，仅内部使用，不得写入客户交付物。

## 技术与布局

- 包管理：pnpm 10.27 workspace（`apps/*`、`packages/*`）。Node 20、NestJS 10、TypeScript 5、PostgreSQL 16、Redis 7、FastGPT、Rust napi-rs。
- `apps/adapter`：数据面入口 `src/main.ts`；控制面入口 `src/control-plane-main.ts`（独立端口、库、鉴权）。同一镜像，不新建 `apps/control-plane`。
- `packages/shared`：`Result`、流水线错误码、脱敏。`packages/license-native`：验签 / 指纹 / 反回放 / 反调试。`deploy/` 与 `scripts/`：安装、备份、租户恢复。`tools/license-issuer`：仅交付方内部签发。
- 模块对应：`wecom` M1、`routing` M2、`context` M3、`qa` M4、`miss` M5、`filter` M6、`config` M7、`media` M8、`license` M9、`import` M10、`platform` + `control-plane` M11。管理面在 `admin/`，探活在 `health/`，内部同步在 `internal/`。

## 架构硬规则

- **R-1** 企微 HTTP 只走 `WecomClient`（`apps/adapter/src/wecom/wecom-client.ts`）。素材外发也走它。
- **R-2** FastGPT 只走 `FastGPTClient`（`apps/adapter/src/qa/fastgpt.client.ts`）。问答、数据集、检索、collection 计数共用这一出口。
- **R-3** 含动态内容的出站群文本必须过 `filter`。固定话术与管理员配置的素材标题除外；文件/视频二进制不过滤。
- **R-4** 授权闸门在管道入口。受限模式下不进入上下文、问答、过滤。
- **R-5** 配置只经 `ConfigService`。密钥只来自环境变量，启动用 zod 全量校验，缺失即 fail-fast 退出。
- **R-6** 素材只落 `data/assets/`；导入临时文件只落 `data/import/` 且用完即删；license 只在 `license/`。
- **R-7** 适配层只读写 Redis 与本库 PostgreSQL。不直连 FastGPT 的 Mongo 或 pgvector。
- **R-8** 导入单并发、可暂挂。不得为导入牺牲实时问答。

分层：`Controller → Service → Client/Repository`。外部 IO 经接口注入，单测用 stub。依赖方向：`wecom → routing → license → context/media → qa → filter`，出站经 `IMessageSender` 回到 `WecomClient`。`QaOrchestrator` 不得直接 import `WecomClient`。禁止模块环。横切模块（`miss` / `config` / `admin` / `health`）可被管道引用，不得反向依赖管道。

## 错误、日志、数据

- 管道错误用 `packages/shared` 的数值码（企微 1xxxx、路由 2xxxx、编排 3xxxx、过滤 4xxxx、素材 5xxxx、授权 9xxxx）和 `Result`。管理面 / 平台用字符串 `errCode`（如 `TENANT_NOT_FOUND`）。新增码跟现有前缀，不要另起一套。
- 可预期业务分支打 INFO，不打栈。外部 IO 按降级矩阵 WARN。未捕获异常由全局过滤器返回 `INTERNAL_ERROR`，避免企微重推风暴。
- 日志用现有 pino 封装。保留 `traceId`。`chatId` / `userId` 只落哈希。问题、答案、正文、token、密码、license 必须走已有 redact / `maskPII`。不要新增绕过脱敏的 logger。
- 管理面：Basic Auth + IP 白名单。`/internal/*` 用内部 token。平台危险操作保留 reason 审计。
- 租户数据按实例隔离。开通、配额、订阅状态机、注销删除走 `platform/` 已有服务，不在数据面复制一套租户库。
- 数据面迁移：`miss/`、`media/`、`license/`、`import/` 下的 `NNN-*.sql`（三位序号）。`shell-provisioner` 只收集这四目录；控制面 SQL 留在 `platform/`。新表跟所属模块，序号不要与已有文件冲突。

## 授权

- 不要削弱验签、机器指纹、反回放、反调试。`USE_MOCK_LICENSE` 只跳过签名与反回放，不跳过格式和机器绑定。
- `packages/license-native/test_keys/` 仅开发。生产签发不得使用该 PEM，不得把客户 license、私钥、`.env` 写入提交。
- 交付镜像的混淆与 native 预编译按 `deploy/Dockerfile.adapter` 现有管线，不要在业务代码里再包一层自研壳。

## 测试与命令

单测在 `apps/adapter/test/**/*.spec.ts`，不连真实企微、FastGPT、Redis、PostgreSQL。集成测试仅 `test/integration`，且依赖 `TEST_PG_URL`，未设置时 skip。真实栈冒烟只走 `scripts/acceptance-real.sh`（`REAL_COMPOSE=1`）。

改管道或横切模块时补同行为的 spec。覆盖率门禁以 `apps/adapter/jest.config.cjs` 为准：全局 ≥75%；`wecom/routing/context/qa/filter/miss/media` ≥80%；`config/license/admin/health/common` ≥60%。用补测试满足门禁，不要下调阈值。

```bash
pnpm -C apps/adapter test
pnpm -C apps/adapter test:cov
pnpm -C apps/adapter build
pnpm -C apps/adapter test:integration   # 需要 TEST_PG_URL
```

## 并行子代理

定义在 `.cursor/agents/`。同一时刻只有一个代理写同一个文件。领域代理只写自己的目录；`app.module.ts`、`admin.module.ts`、`packages/shared`、`src/common`、`src/config`、`jest.config.cjs`、`test/__setup__` 只由 `adapter-foundation` 写。接线等领域代理交出清单后再改。

| 代理 | 写权限 |
|---|---|
| `spec-author` | `openspec/` |
| `wecom-adapter` | `src/wecom` |
| `message-routing` | `src/routing`、`src/context`、`src/filter` |
| `qa-orchestrator` | `src/qa` |
| `miss-records` | `src/miss`、miss 管理控制器 |
| `media-assets` | `src/media` |
| `import-pipeline` | `src/import` |
| `platform-saas` | `src/platform`、`src/control-plane`、`src/internal`、`src/usage` |
| `license-core` | `src/license`、`packages/license-native` |
| `adapter-foundation` | 共享接线、配置、日志、测试夹具 |
| `deploy-ops` | `deploy/`、`scripts/` |
| `boundary-reviewer` | 只读审查 |

## 改代码时

- 只改任务相关文件。行为变化先对照 `openspec/specs/` 里对应规格；规格未覆盖的新行为先补规格再实现。
- 匹配现有命名、Nest 模块装配和错误码风格。单文件保持可维护，不要把编排、IO、SQL 堆进同一个服务。
- 输入在系统边界校验（回调、管理接口、环境变量、上传文件、租户标识）。SQL 用参数化查询。路径拒绝 `..`。
- 不提交密钥、`.env`、coverage、`dist/`、运行时 `data/`。未要求时不提交、不推送、不改 git config。
- 不新增客户向文档，除非任务明确要求。文档路径以仓库实际目录为准（`docs/02-需求与设计/`，不是 README 里过期的 `docs/02-产品设计/`）。
