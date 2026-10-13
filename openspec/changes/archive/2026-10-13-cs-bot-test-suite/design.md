# Design

## Context

cs-bot-mvp-foundation 已归档：adapter 全部 11 个模块生产代码 + 部署套件均落地，编译通过。但 `apps/adapter/test/` 下 9 个测试骨架（合计 296 行）是占位性质——存在以下问题导致 `pnpm test` 不能直接运行：

1. **ConfigService 静态单例耦合**：`WecomCrypto`、`TriggerService`、`DedupService`、`ContextService`、`SensitiveFilterService`、`MissService`、`MockLicenseVerifier`、`QaOrchestrator` 都通过 `ConfigService.instance` 访问配置，单测直接 `import` 服务就会触发 zod 校验，缺失 `.env` 时 `process.exit(1)`。这要求每个 spec 在 beforeAll 阶段 `process.env.*` 注入或 `jest.isolateModules` 重置环境。
2. **jest ESM + ts-jest 不匹配**：当前 jest.config.cjs 启用 `extensionsToTreatAsEsm: ['.ts']` 但项目主包 `"type": "module"` 缺省、tsconfig 是 NodeNext，ts-jest 在 strict ESM 模式下导入 `import { something } from './foo.js'` 路径会因 .js→.ts 解析失败。需要选 CommonJS transform 或 ESM + 显式 NodeNext tsconfig。
3. **覆盖率 glob 语法错误**：`src/filter/**/*..ts` 多了点，glob 不匹配任何文件导致覆盖率永远为空。
4. **部分服务对外部依赖强绑定**：`QaOrchestrator` 接受 `IQAEngine` 接口，但 `RateLimiter` 等对 Redis 客户端直接 `new Redis(...)`，单测需要劫持 ioredis 构造。

## Goals / Non-Goals

**Goals:**
- `pnpm -C apps/adapter test` 在干净工作区首次运行即绿（不依赖 docker compose、不依赖本机 Redis/PG）。
- 9 个现有骨架修正为可运行用例 + 补充 qa-orchestrator / config.service / routing.service / wecom-client / miss.service 的 spec。
- 覆盖率门禁生效：管道 ≥80%、横切 ≥60%、全局 ≥60%。
- 冒烟 spec（`smoke.spec.ts`）用 NestJS 的 `Test.createTestingModule` 启动应用，对 `/healthz`、`/admin/license` 发起真实 HTTP 调用（in-process）。

**Non-Goals:**
- 不引入 e2e docker compose 测试（归入下一个 change：cs-bot-integration-suite）。
- 不做 React/Vue 前端测试（前端尚未纳入 MVP）。
- 不引入 mutation testing、性能测试、负载测试。
- 不重写生产代码；仅在测试需要时对生产代码做最小侵入（必要时把 `new Redis(...)` 改为 `new Redis(opts, { lazyConnect: true })` 已满足，不算重写）。

## Decisions

### 决策 1：jest 跑在 CommonJS transform 模式

- **方案**：保留 ts-jest 但关闭 `useESM`，使用 `useESM: false`、`isolatedModules: true`、tsconfig 覆盖 `module: 'commonjs'`、`esModuleInterop: true`、`experimentalDecorators: true`。jest 自身按 CJS 运行测试，`.ts` 文件由 ts-jest 实时编译。
- **备选**：ESM 模式——require 原 `import('./foo.js')` 必须配 `.js` 后缀，会强制把全部源码改写，太侵入。
- **取舍**：CJS 模式最简单，不会污染生产构建（生产构建仍走 `tsc` 输出 ESM 即可，或保留 CJS 视最终决定）。

### 决策 2：用 jest.isolateModules + 临时 stub 隔离 ConfigService.instance

- **方案**：每个 spec 在 `beforeAll` 阶段做：
  1. `process.env` 注入 12 个必备变量（mock 模式完整版 .env）；
  2. `jest.isolateModules(() => { const m = require('../src/config/config.service'); ConfigService.instance = m.ConfigService.instance; ... })`。
  3. 在 `afterAll` 还原。
- **备选**：jest.mock 整个 `./config.service` 模块；缺点：mock 后丢失类型，无法在测试中读 `ConfigService.instance.REDIS_HOST` 做断言。
- **取舍**：选择 isolateModules 模式；保留真实 ConfigService 加载，验证 zod schema 同样工作。

### 决策 3：用 jest.mock('ioredis') 隔离 Redis 客户端

- **方案**：在 `test/__setup__/redis.mock.ts` 提供 stub：所有方法返回 `Promise.resolve()` 或预定义值，INCR 返回数字递增。`set EX NX` 返回 `'OK'` 一次后返回 `null` 以模拟 dedup 二次重复。
- **备选**：集成本地 redis-server——违反"不依赖 docker"。
- **取舍**：stub 方案。Redis 客户端与业务逻辑解耦（业务代码只调用 `.set/.get/.incr/.eval/.evalsha/.expire/.multi/.del/.script/.disconnect/.ping/.ttl`），stub 实现这些方法即可。

### 决策 4：用 jest.mock('axios') + jest.mock('pg') 隔离外部

- **方案**：axios mock 默认返回 `{ data: { errcode: 0, access_token: 'mock' } }`；pg Pool mock 的 query 方法返回 `{ rows: [] }`。
- **取舍**：与决策 3 一致。

### 决策 5：覆盖率 glob 修正

- 把 `'src/filter/**/*..ts'` 改为 `'src/filter/**/*.ts'`。

### 决策 6：冒烟测试用 NestJS Test module

- **方案**：在 `smoke.spec.ts` 用 `@nestjs/testing` 的 `Test.createTestingModule({ imports: [AppModule] })`，但提前在 jest.mock 层把 `ioredis`、`pg`、`axios` 全部替换。然后 `app.init()` 拿到 `INestApplication`，用 `supertest(app.getHttpServer())` 发起真实 HTTP 调用。
- **取舍**：与决策 3-4 一致；选 supertest 而非裸 http.request 是因为 NestJS 应用需要先 listen。

### 决策 7：覆盖率阈值管道/横切分级

- **方案**：`coverageThreshold.global` 设 60%（满足 jscover 命令）；
  - 不为每个目录单独设阈值（jest 同一文件只能属于一个 glob，不可同时被两个阈值覆盖）；
  - 通过把 `collectCoverageFrom` 拆成两组 glob 来模拟"管道模块 ≥80% / 横切模块 ≥60%"：
    - `src/(wecom|routing|context|qa|filter|miss|media)/**/*.ts` 走 80%
    - 其余走 60%
  - 在 jest 配置中分两组 `coverageThreshold` 不被支持（jest 是全局单阈值），所以策略改为：在 test:cov 脚本里用 `npx jest --coverage --coverageThreshold='{"global":{"lines":80,...}}` 跑管道目录覆盖版本，再单独跑横切目录覆盖版本（调整 `collectCoverageFrom`）。
  - **妥协方案**：jest 不支持分组阈值；本 change 退化为 `coverageThreshold.global.lines = 75`（介于两者之间，约束管道不能太低、横切不能太低），并用 README 注明后续如需严格分组，需切换到 c8/istanbul + 自定义报告合并脚本。
- **取舍**：MVP 测试阶段分两组阈值意义不大，先全局 75% 满足 CI 通过；后续按需演进。

## Risks / Trade-offs

- **R1**：隔离模块重置 `process.env` 在并发测试下可能互相污染——规避：jest 默认单 worker 串行 file 级别跑测试；并发只在 file 内 beforeAll 之间由 jest 控制。
- **R2**：`jest.isolateModules` 不能模拟 `import` 顶层代码副作用——可接受：当前生产代码 `import { ConfigService } from '../config/config.service.js'` 不带副作用（只有 `ConfigModule` 装饰器触发元数据生成，无运行时副作用）。
- **R3**：覆盖率"管道/横切分组阈值"被简化成全局 75%——可接受：MVP 测试阶段目标不是审计，是给出可执行基线。
- **R4**：覆盖率报告对 ahocorasick 等 npm 库覆盖会偏低——已通过 `coveragePathIgnorePatterns` 排除 `node_modules`。
