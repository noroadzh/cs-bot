# Tasks

## 1. Jest 基建修正

- [ ] 1.1 修正 `jest.config.cjs`：`useESM` 改为 `false`，移除 `extensionsToTreatAsEsm`，tsconfig 覆盖 `module: 'commonjs'`，修正 `'src/filter/**/*..ts'` 为 `'src/filter/**/*.ts'`
- [ ] 1.2 修正 `apps/adapter/package.json` test scripts：移除 `NODE_OPTIONS='--experimental-vm-modules --no-warnings'`，改为 `jest`
- [ ] 1.3 创建 `test/__setup__/env.ts`：统一 inject 12 个 mock 环境变量到 `process.env`，提供 `resetEnv()` 恢复
- [ ] 1.4 创建 `test/__setup__/redis.mock.ts`：stub ioredis（INCR 递增、`SET EX NX` 首次返回 OK 后返回 null、`MULTI`/`EXEC` 透传）
- [ ] 1.5 验证 `pnpm -C apps/adapter test --listTests` 能列出全部 spec 文件

## 2. 现有骨架重写（9 个）

- [ ] 2.1 重写 `wecom-crypto.spec.ts`：stub ConfigService.instance → MockCrypto（绕过 Redis+axios），覆盖：验签通过/失败、AES 加解密往返、parseXml 正常/损坏、3.5s answerPromise 竞速
- [ ] 2.2 重写 `trigger.service.spec.ts`：用 `ioredis-mock` + 临时 keywords.yml，覆盖：@mention/关键词前缀/自发言/非文本无@ 4 条短路路径、关键词计数热重载
- [ ] 2.3 重写 `dedup.service.spec.ts`：stub Redis，覆盖：首次/重复/空 MsgId、Redis 异常 fail-open
- [ ] 2.4 重写 `rate-limiter.service.spec.ts`：stub Redis，覆盖：群限超/用户限超/未超限/Redis 异常 fail-open
- [ ] 2.5 重写 `context.service.spec.ts`：用 `ioredis-mock`，覆盖：5 轮截断（append 10 次验证 LTRIM）、TTL 设置、get fail-open、clear
- [ ] 2.6 重写 `sensitive-filter.service.spec.ts`：stub `fs.readFileSync/watcher`，覆盖：命中替换/未命中/空词表/热重载/多命中全部替换
- [ ] 2.7 重写 `mock-qa.engine.spec.ts`：覆盖：Jaccard 命中/Jaccard 低兜底/默认词表/自定义路径加载
- [ ] 2.8 重写 `license-mock.spec.ts`：覆盖：无文件 valid+mock / 有合法文件 valid+!mock / 文件损坏 invalid
- [ ] 2.9 重写 `admin.guard.spec.ts`：stub ConfigService.instance，覆盖：IP 白名单/白名单 CIDR / Basic Auth 缺失/错误/正确

## 3. 新增 spec（5 个）

- [ ] 3.1 创建 `qa-orchestrator.spec.ts`：mock IQAEngine/IContextService/ISensitiveFilter/IMissService/IAssetSender/IWecomClient，覆盖：置信度 ≥0.75 写 context / <0.75 触发 miss 记录 / 分段文本 / 素材 ID 提取
- [ ] 3.2 创建 `config.service.spec.ts`：覆盖：zod 校验必填字段缺失时抛出 / 字段类型错误时抛出 / 正常实例化
- [ ] 3.3 创建 `routing.service.spec.ts`：mock 下游 4 服务，覆盖：dedup 命中跳过 / 未触发跳过 / 限流命中跳过 / 正常路由到 orchestrator
- [ ] 3.4 创建 `wecom-client.spec.ts`：mock axios，覆盖：sendText/sendFile/sendVideo/uploadMedia 正常路径、access_token 刷新路径
- [ ] 3.5 创建 `miss.service.spec.ts`：stub pg Pool，覆盖：record 异步入库 / FIFO 1000 上限 / PG 异常 FIFO 重试

## 4. 端到端冒烟

- [ ] 4.1 创建 `smoke.spec.ts`：NestJS `Test.createTestingModule` 启动 AppModule（全局 jest.mock 替换 ioredis/pg/axios），用 supertest 请求 `/healthz`（200 断言）/ `/admin/license` 无认证（401）/ `/admin/license` 带正确 Basic Auth（200 + valid=true）

## 5. 覆盖率门禁

- [ ] 5.1 修正 `jest.config.cjs` `coverageThreshold.global`：lines/branches/functions/statements 全部设为 75
- [ ] 5.2 执行 `pnpm -C apps/adapter test:cov`，确认覆盖率摘要输出且所有阈值通过

## 6. 验证

- [ ] 6.1 `pnpm -C packages/shared build` → 退出码 0
- [ ] 6.2 `pnpm -C apps/adapter build` → 退出码 0，无 `error TS`
- [ ] 6.3 `pnpm -C apps/adapter test` → 全部 spec passed，退出码 0
- [ ] 6.4 `openspec validate cs-bot-test-suite --strict --type change` → valid
