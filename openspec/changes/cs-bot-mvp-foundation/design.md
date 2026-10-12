# Design: cs-bot-mvp-foundation

## Context

《详细设计 V1.0》和《概要设计 V1.8》已给出模块划分（M1–M9）和数据流（D1–D10），但它们是"目标态"设计；本 change 的工程当前状态是**完全空仓**（仅 `openspec/` 配置目录和 `docs/` 文档）。本设计负责将"目标态"切片到"可落地工程结构"，并在 mock-first 原则下保证开发期不依赖任何外部服务。

**关键约束**：
- 客户基线（无任何增项）报价 ¥27,500 / 25 人天，增项包按勾选后追加；
- 同一代码基线支撑私有化部署（基线）和 SaaS 托管（增项 C）；
- 闭源交付（不含源码），但 Dockerfile 多阶段构建并启用 javascript-obfuscator 防逆向。

## Goals / Non-Goals

**Goals**:
- 单仓 monorepo 结构（pnpm workspace），单 NestJS 应用 `apps/adapter`
- 11 个能力 spec 中，**仅实现基线 11 个能力对应模块（M1–M7 + M9 + 部署套件）**
- 通过 `USE_MOCK_LLM` 与 `USE_MOCK_LICENSE` 两把开关保证开发期网络零外呼
- 部署套件以 Docker Compose 6 容器交付（adapter/fastgpt/pg/mongo/redis/nginx）
- 管理接口 Basic Auth + IP 白名单
- 启动强校验（zod schema fail-fast）+ 凭证存在性校验（mock 模式不断网络）

**Non-Goals**:
- 不实现增项包：A（多媒体与素材）、B（历史导入）、C（SaaS 控制面）、D（本地模型）
- 不实现 Rust `license-native` 原生模块（仅占位目录 + `ILicenseVerifier` 接口）
- 不实现 `/admin/assets`、`/admin/import/*`、`/platform/*` 任何路由骨架
- 不实现图片识别、qwen-vl 集成
- 不实现 FastGPT 数据集写入 API（仅只读 `ask`）
- 不实现对外 Webhook 告警（仅占位日志接口）
- 不实施 OAuth/RBAC 管理后台鉴权（Basic Auth 足够）

## Decisions

### D1. 模块边界与依赖方向
**选择**：严格遵循详细设计 §1.2 的单向依赖链 `wecom → routing → license → context → orchestration → filter → wecom`。

**备选**：自由组合导入。**否决原因**：详细设计已规定 ESLint `nx/enforce-module-boundaries` 校验，单向链可避免循环依赖与"在 License 模块写业务逻辑"之类的腐化。

**实施**：`apps/adapter/src/` 下划分子目录，每个模块只暴露 `index.ts`，禁止 deep import。

### D2. IQAEngine 抽象层
**选择**：定义 `interface IQaEngine { ask(req): Promise<Result<AskResp>> }`，`MockQaEngine` 与 `FastGPTQaEngine` 在 `qa/` 下并列，启动时根据 `USE_MOCK_LLM` 选择并注入。

**备选**：直接写两个分支 if/else。**否决原因**：测试与切换成本高，且后续增项 D（本地模型）也要走同一抽象。

**实施**：`packages/shared/qa-types.ts` 定义类型，`apps/adapter/src/qa/mock-qa.engine.ts` 与 `fastgpt-qa.engine.ts` 并列实现，`qa.module.ts` 工厂导出。

### D3. ILicenseVerifier 抽象层
**选择**：`interface ILicenseVerifier { verify(): Promise<LicenseState> }`，`MockLicenseVerifier`（仅校验文件格式存在 + 解析 payload）与 `NativeLicenseVerifier`（待注入）并列，`USE_MOCK_LICENSE=true` 时工厂返回 mock。

**备选**：单文件内置 if/else。**否决原因**：客户机上 Rust 二进制未就绪前需要完整开发流程；mock 与 native 必须在同一接口下严格行为一致（除 mock 永远返回 valid）。

**实施**：`packages/license-native/` 占位目录含 README；`apps/adapter/src/license/license.types.ts` 定义接口；`apps/adapter/src/license/mock-license.verifier.ts` 实现。

### D4. 凭证校验策略
**选择**：所有外部凭证（企微 CorpID/Secret/AgentId/Token/AESKey、FastGPT BaseURL/ApiKey、DeepSeek ApiKey、DashScope ApiKey）启动时**全部校验存在性**（非空 + zod 格式），但**仅在 mock=false 时**调用 `ping`/`gettoken` 等连通性检查。

**备选**：mock 模式完全跳过凭证检查。**否决原因**：与客户对齐的策略"凭证必须有，mock 不断网络"——前者保证部署包一致性，后者保证开发流畅。

**实施**：`apps/adapter/src/config/config.schema.ts` 用 zod 严格定义；`config.service.ts` 在启动 `onModuleInit` 中读 `.env`，mock 模式下不调任何远程端口。

### D5. 上下文存储结构
**选择**：Redis JSON 数组（不是 Hash），单 key `ctx:{chatId}:{userId}`，每次写入先 `GET` 反序列化、`PUSH`、再 `SET EX 600`。读写共 3 RTT。

**备选**：Redis Hash + HSET 单字段。**否决原因**：5 轮上限的截断需要"读全部再写全部"语义，Hash 改写单字段要 HGETALL + 序列化，写仍要全部；JSON 数组用 `MULTI/EXEC` 事务更直观。

**实施**：`apps/adapter/src/context/context.service.ts` 使用 ioredis pipeline `multi`/`exec`，避免并发截断 race。

### D6. 敏感词 AC 自动机
**选择**：直接使用 `ahocorasick` 成熟 npm 库（~50ms 构建 10K 词），不手写双数组。

**备选**：自研 DFA 双数组。**否决**：手写 ~300 行维护成本高，npm 库 `ahocorasick` 已验证且支持中文 UTF-8。

**实施**：`apps/adapter/src/filter/aho.service.ts` 包装 `ahocorasick`，`fs.watch` 监 `config/sensitive-words.txt`，防抖 500ms。

### D7. miss-record 导出
**选择**：exceljs `WorkbookWriter` 流式生成（不写 `workbook.xlsx` 中间文件），通过 Fastify reply 写流。

**备选**：导出后存盘再 `sendFile`。**否决原因**：1 万条 miss 在内存不可控；流式写出即可。

**实施**：`apps/adapter/src/miss/miss-export.service.ts` 使用 `ExcelJS.stream.xlsx.WorkbookWriter`。

### D8. 启动顺序与可观测性
**选择**：`main.ts` 严格顺序：`ConfigService` zod 校验 → `LicenseVerifier.verify()` 缓存 → Redis 探活 → PostgreSQL 探活 → 注册全局异常过滤器 → `app.listen()`。每个阶段失败立即 `exit(1)` 并打印阶段名。

**备选**：懒加载模式（请求来才校验）。**否决原因**：fast-fail 是详细设计的 fail-fast 原则，连接耗尽时延迟失败代价高。

**实施**：`apps/adapter/src/main.ts` `bootstrap()` 函数顺序执行，pino logger 在每个阶段打印 `phase: ready/error`。

### D9. 部署套件打包
**选择**：Dockerfile 多阶段（builder → native → runtime），runtime 用 `gcr.io/distroless/nodejs20-debian12:nonroot`，镜像内嵌混淆产物与 prebuilds。

**备选**：直接 node:20-alpine。**否决原因**：详细设计 §8 明确规定 distroless 减少攻击面。

**实施**：`deploy/Dockerfile.adapter` + `deploy/docker-compose.yml` + `deploy/nginx/nginx.conf` + `deploy/backup.sh`。

### D10. 单测策略
**选择**：Jest + supertest + ioredis-mock + pg-mem，**所有管道模块覆盖率 ≥80%**；**不跑 docker compose 集成测试**（留给交付前）。

**备选**：真实 docker compose 集成测试。**否决原因**：CI 跑 6 容器太重，开发期用 stub 更高效；交付前人工集成测试更可靠。

**实施**：`apps/adapter/test/unit/` 下每个模块一个 `*.spec.ts`；覆盖率门禁在 `jest.config.cjs` 配置。

## Risks / Trade-offs

### R1. mock 模式隐藏了真实 FastGPT 行为
[Risk] Mock 与真实 FastGPT 在置信度分布、引用格式、超时边界上有偏差，部署前切换可能有意外。  
**Mitigation**: Mock 数据集至少包含 10 条带分数标注的样例；交付前在 README 强制"切换真实引擎后必须跑集成测试"。

### R2. Redis JSON 数组读写竞态
[Risk] 同一用户高频消息并发时，`GET → modify → SET` 流程可能丢更新。  
**Mitigation**: 用 `MULTI/EXEC` 或 `WATCH/MULTI/EXEC` 乐观锁；写失败重试 1 次。

### R3. Mock 许可证永远 valid
[Risk] 开发者误把 mock 模式带到生产环境，导致 license 失效但服务仍运行。  
**Mitigation**: `/admin/license` 永远返回 `mock: true/false`，部署手册明确要求生产 `USE_MOCK_LICENSE=false`；启动日志 WARN 醒目标识。

### R4. 企微回调 3.5s 竞速在 adapter 重启时丢失
[Risk] 被动回复超时后答案进入主动补发队列，若 adapter 在 send 之前崩溃，消息丢失。  
**Mitigation**: 详细设计 §3.1 要求"立即回 200 空体"+"投递管道异步"，崩溃前已经回 200，企微不重试；接受丢失风险（详细设计已确认）。

### R5. sensitive-words.txt 编码与换行
[Risk] Windows 编辑保存 UTF-8 BOM + CRLF 导致 AC 自动机构建失败。  
**Mitigation**: 加载时 strip BOM，统一换行 `\n`；启动时校验词数 > 0；为 0 时 WARN 提示。

### R6. 凭证 .env 在 git 历史泄露
[Risk] 客户填写 `.env` 后不小心提交。  
**Mitigation**: `.gitignore` 默认忽略 `.env`；`git log` 校验脚本纳入交付前 checklist；管理面 `/admin/config-check` 永远不返回明文。

### R7. 单测覆盖率门禁可能拖慢交付
[Risk] 25 人模板覆盖率拉满 80% 需要时间。  
**Mitigation**: 明确"管道模块 ≥80%"，"横切模块（config/license）≥60%"；失败的模块列出豁免清单与原因（写入 deploy/quality-exceptions.md）。

## Migration Plan

**首次部署（开发期）**:
```bash
pnpm install
pnpm -C apps/adapter build
pnpm -C apps/adapter start        # mock 模式启动
curl -u admin:dev http://localhost:3000/admin/config-check
```

**交付前切换真实模式**:
```bash
sed -i 's/USE_MOCK_LLM=true/USE_MOCK_LLM=false/' .env
sed -i 's/USE_MOCK_LICENSE=true/USE_MOCK_LICENSE=false/' .env
# （后续 change）将 license-native prebuilds/*.node 放入 packages/license-native/prebuilds/
docker compose build adapter
docker compose up -d
curl -u admin:**** https://<domain>/healthz
curl -u admin:**** https://<domain>/admin/license   # valid=true,mock=false
```

**回滚**（如有问题）:
- adapter 单服务：`docker compose restart adapter`（数据无破坏）
- 凭证回退：恢复上一份 `.env`，再 `restart`
- 数据回滚：参考部署手册 §9.2 的 PG/mongo 恢复流程

## Open Questions

无。所有架构决策均在详细设计 V1.0 内已明确。
