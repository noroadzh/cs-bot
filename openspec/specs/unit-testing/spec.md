# unit-testing Specification

## Purpose
定义 cs-bot adapter 的单元测试基建与必测行为契约，确保回归安全网覆盖全部管道模块与横切模块。

## Requirements

### Requirement: 测试基建可执行

`apps/adapter` MUST 提供一份 jest 配置，开发者执行 `pnpm -C apps/adapter test` 时全部测试可被发现、编译、执行，且 0 失败、0 待修复（skipped 允许但必须显式标注）。`pnpm -C apps/adapter test:cov` MUST 在所有测试通过的前提下输出覆盖率摘要。

#### Scenario: 首次执行测试
- **WHEN** 在干净的工作区执行 `pnpm -C apps/adapter test`
- **THEN** jest 找到所有 `test/**/*.spec.ts` 并通过运行，退出码为 0
- **AND** 没有任何 spec 因配置错误（ts-jest、ESM、模块路径映射）抛出

#### Scenario: 覆盖率摘要可生成
- **WHEN** 执行 `pnpm -C apps/adapter test:cov`
- **THEN** 终端输出 `Coverage summary` 表格，包含 lines / branches / functions / statements 四项

### Requirement: Mock 隔离原则

单元测试 MUST 不依赖真实外部服务。Redis、PostgreSQL、企微 HTTP API、FastGPT HTTP API 在测试期间 MUST 用 stub 或 jest mock 完全替换；任何 spec 文件不得发起真实网络连接或本地 socket 监听。

#### Scenario: 离线运行测试
- **WHEN** 关闭 docker compose、关闭本机 Redis/PG 服务后执行 `pnpm -C apps/adapter test`
- **THEN** 所有测试仍然通过；不会出现 ECONNREFUSED 错误导致测试失败

#### Scenario: 企微 API 被拦截
- **WHEN** `WecomClient` 测试断言 sendText/sendFile/uploadMedia 行为
- **THEN** axios 被 jest.mock 拦截，测试不实际请求 `qyapi.weixin.qq.com`

### Requirement: 管道模块测试覆盖

wecom-crypto、trigger、dedup、rate-limiter、context、filter、mock-qa-engine、qa-orchestrator、miss 共 9 个核心服务 MUST 各有至少一份 spec 文件。管道模块（wecom/routing/context/qa/filter/miss/media 目录）行覆盖率 MUST ≥80%。

#### Scenario: WecomCrypto 行为测试
- **WHEN** 执行 `test/wecom-crypto.spec.ts`
- **THEN** 覆盖：验签通过/失败、AES-256-CBC 加解密往返、parseXml 解析带 AtList 文本、parseXml 容错（XML 损坏返回 null）

#### Scenario: TriggerService 短路顺序
- **WHEN** 执行 `test/trigger.service.spec.ts`
- **THEN** 覆盖：自发言跳过、bot 自身发言跳过、非文本未@跳过、@触发、关键词前缀匹配触发、空文本不触发、关键词热重载计数刷新

#### Scenario: DedupService 幂等
- **WHEN** 执行 `test/dedup.service.spec.ts`
- **THEN** 覆盖：首次 MsgId 返回非重复、相同 MsgId 二次调用返回重复、空 MsgId 返回非重复、Redis 异常 fail-open 返回非重复

#### Scenario: RateLimiterService 双层限流
- **WHEN** 执行 `test/rate-limiter.service.spec.ts`
- **THEN** 覆盖：群级超限返回 group scope 超限、用户级超限返回 user scope 超限、未超限 allowed=true、Redis 异常 fail-open allowed=true

#### Scenario: ContextService 截断与 fail-open
- **WHEN** 执行 `test/context.service.spec.ts`
- **THEN** 覆盖：append 后只保留最近 5 轮（10 条）、TTL 写入正确、Redis 异常时 get 返回空数组且 append 不抛错、clear 移除 key

#### Scenario: SensitiveFilterService
- **WHEN** 执行 `test/sensitive-filter.service.spec.ts`
- **THEN** 覆盖：命中替换为 `[内容已过滤]`、未命中原文返回、空 automaton 跳过、多命中全部替换、reload 重新加载词表

#### Scenario: MockQaEngine 匹配与兜底
- **WHEN** 执行 `test/mock-qa.engine.spec.ts`
- **THEN** 覆盖：Jaccard 命中返回 best pair、相似度过低返回兜底文案、默认词表 10 条加载、自定义文件路径加载

### Requirement: 横切模块测试覆盖

config、license、admin、health、common 共 5 个横切模块 MUST 各有至少一份 spec 文件。横切模块（config/license/admin/health/common 目录）行覆盖率 MUST ≥60%。

#### Scenario: MockLicenseVerifier 三态
- **WHEN** 执行 `test/license-mock.spec.ts`
- **THEN** 覆盖：无 LICENSE_FILE 时返回 valid+mock、有 LICENSE_FILE 且 JSON 合法时 valid+!mock、JSON 损坏时 invalid

#### Scenario: AdminGuard 鉴权
- **WHEN** 执行 `test/admin.guard.spec.ts`
- **THEN** 覆盖：IP 不在白名单 403、IP 在白名单但 Basic Auth 缺失 401、IP+Auth 错误 401、IP+Auth 正确放行、CIDR 子网判定

### Requirement: 覆盖率门禁

`apps/adapter/jest.config.cjs` MUST 设置 `coverageThreshold`，管道模块在覆盖率 <80% 或横切模块在覆盖率 <60% 时 jest 退出码非 0。

#### Scenario: 覆盖率不足阻断
- **WHEN** 临时删除一个核心断言使某管道模块行覆盖降至 70% 后执行 `pnpm -C apps/adapter test:cov`
- **THEN** jest 报告 `Coverage threshold not met` 并以非 0 退出码结束
