# Tasks: cs-bot-mvp-foundation

> 基线 MVP 实施任务清单。任务按依赖顺序排列；验证标准写在每个任务的方括号内。

---

## 1. 工程骨架

- [ ] 1.1 初始化 pnpm monorepo：创建 `pnpm-workspace.yaml`、`tsconfig.base.json`（`"paths": { "@cs-bot/shared": ["packages/shared/src"] }`），验证 `pnpm install` 无错误
- [ ] 1.2 创建 `packages/shared/src/index.ts`，导出 `Result` 类型、`ErrCode` 枚举（含 wecom/routing/orchestration/filter/miss/license/config 所有错误码）、脱敏函数 `maskPII()`
- [ ] 1.3 创建 `apps/adapter/` NestJS 应用骨架（`nest new` 不跑，用手动文件），`src/main.ts` 含 bootstrap 顺序骨架（Config → License → Redis → PG → listen），`src/app.module.ts` 根模块含所有子模块 import 占位
- [ ] 1.4 创建 `packages/license-native/README.md`（说明后续注入 Rust 模块路径），`packages/license-native/src/index.ts` 导出空函数占位
- [ ] 1.5 创建 `.gitignore`（含 `.env`、`node_modules/`、`dist/`、`*.log`）

---

## 2. M7 配置管理

- [ ] 2.1 创建 `apps/adapter/src/config/config.schema.ts`：zod schema 含所有必填项（WECHAT_*/FASTGPT_*/LLM_*/ADMIN_*/USAGE_REPORT_ENABLED）+ 格式校验（corpId/regex、AESKey/43chars），含 `USE_MOCK_LLM`/`USE_MOCK_LICENSE`/`CONFIDENCE_THRESHOLD`/`CONTEXT_ROUNDS`/`CONTEXT_TTL_SEC`/`LLM_TIMEOUT_MS`/`MISS_RECORD_RETENTION_DAYS`/`SLOW_REPLY_TEXT`
- [ ] 2.2 创建 `apps/adapter/src/config/config.service.ts`：`ConfigService` 在 `onModuleInit` 中读取 `.env` 并 zod 校验，fail 时打印缺失清单并 `process.exit(1)`；导出 `appConfig` 单例
- [ ] 2.3 创建 `.env.template`，包含所有变量及注释（参考部署手册 §7.3），验证 `cp .env.template .env && node -e "require('z').object(...)"` 结构校验通过
- [ ] 2.4 创建 `apps/adapter/src/common/pino.logger.ts`：pino 单例，含 `traceId/chatId/userIdHash/msgType/errCode/costMs` 字段，默认 JSON 输出

---

## 3. M9 授权骨架（Mock）

- [ ] 3.1 创建 `apps/adapter/src/license/license.types.ts`：定义 `ILicenseVerifier` 接口 + `LicenseState` 类型
- [ ] 3.2 创建 `apps/adapter/src/license/mock-license.verifier.ts`：`MockLicenseVerifier` 实现，读取 `LICENSE_FILE`，校验格式（base64payload.base64sig），解析 payload（不验签），`USE_MOCK_LICENSE=true` 时永远返回 `{valid: true, reason: 'mock', expiresAt, daysLeft, maxChats, fingerprint, mock: true}`
- [ ] 3.3 创建 `apps/adapter/src/license/license.module.ts` + `LicenseService`：工厂根据 `USE_MOCK_LICENSE` 选择 verifier，`verify()` 结果写入 Redis `license:cache` TTL 3600s；`onModuleInit` 触发首次校验（fail 时 warn 但不 exit）
- [ ] 3.4 创建 `apps/adapter/src/license/license.guard.ts`：管道 D3 位中间件，读取缓存，缓存无效触发 verify，valid=false → `ErrCode.LICENSE_RESTRICTED`
- [ ] 3.5 单元测试：验证 `MockLicenseVerifier` 文件不存在时 warn+返回 valid mock；格式错误时 warn+返回 mock malformed；正确文件时返回 parsed expiresAt

---

## 4. M1 企微接入

- [ ] 4.1 创建 `apps/adapter/src/wecom/wecom-crypto.ts`：实现官方 AES 解密（WXBizMsgCrypt 算法）、SHA1 签名验签
- [ ] 4.2 创建 `apps/adapter/src/wecom/wecom-client.ts`：`WecomClient` 类，含 `sendText/sendFile/sendVideo/uploadMedia/downloadMedia/getAccessToken`，access_token 内存缓存 7000s + Redis SETNX 分布式锁（key=`wecom:at:lock`）
- [ ] 4.3 创建 `apps/adapter/src/wecom/wecom.controller.ts`：`POST /wecom/callback` 入口，验签 → 解密 → XML 解析 → 立即回 200 → 异步投递 `pipeline.process(msg)`
- [ ] 4.4 创建 `apps/adapter/src/wecom/wecom.module.ts`：注入 `WecomClient`
- [ ] 4.5 单元测试：验签通过/篡改/时间戳偏移；AES 解密正确；3.5s 竞速分支（answerPromise 早/晚）；`getAccessToken` 缓存命中

---

## 5. M2 消息路由

- [ ] 5.1 创建 `apps/adapter/src/routing/trigger.service.ts`：`TriggerService`，实现触发短路顺序（isSelfOrBot → 非文本未@ → @解析 → 关键词匹配），关键词用 Trie 前缀匹配（`simple-trie` npm）
- [ ] 5.2 创建 `apps/adapter/src/routing/dedup.service.ts`：`DedupService`，`SETNX dedup:{msgid} EX 172800`，返回 0 → `ErrCode.DEDUP_DUP`
- [ ] 5.3 创建 `apps/adapter/src/routing/rate-limiter.service.ts`：`RateLimiterService`，Lua 脚本原子令牌桶，群级 20/min + 用户级 5/min
- [ ] 5.4 创建 `apps/adapter/src/routing/routing.module.ts`
- [ ] 5.5 创建 `config/keywords.yml` 出厂默认值（含"请问"、"咨询"、"？"）
- [ ] 5.6 单元测试：@解析命中/未命中；关键词命中/未命中；令牌桶第 20/21 次；去重命中

---

## 6. M3 会话上下文

- [ ] 6.1 创建 `apps/adapter/src/context/context.service.ts`：Redis JSON 数组，`ctx:{chatId}:{userId}`，5 轮截断（`LPUSH` + `LTRIM`），TTL 600s，`MULTI/EXEC` 原子写；fail-open 返回空数组
- [ ] 6.2 创建 `apps/adapter/src/context/context.module.ts`
- [ ] 6.3 单元测试：5 轮截断；TTL 续期；Redis 故障 fail-open

---

## 7. M4 问答编排 + M4b Mock QA Engine

- [ ] 7.1 创建 `packages/shared/src/qa.types.ts`：`AskReq`、`AskResp`、`Quote`、`IQAEngine` 接口
- [ ] 7.2 创建 `apps/adapter/src/qa/mock-qa.engine.ts`：`MockQaEngine`，内置 10 条配置化示例问答（从 `config/mock-qa.json` 读取），精确匹配关键词返回答案；无匹配返回 score=0；验证 50ms 内完成、无网络调用
- [ ] 7.3 创建 `apps/adapter/src/qa/fastgpt-qa.engine.ts`：`FastGPTQaEngine`（`USE_MOCK_LLM=false` 时使用），调用 `POST /api/v1/chat/completions`，超时 15s，重试 1 次（退避 1s）
- [ ] 7.4 创建 `apps/adapter/src/qa/qa-orchestrator.ts`：`QaOrchestrator`，读上下文 → 调用 `engine.ask()` → 置信度判定（<阈值 → miss.record + 拒答话术）→ 解析素材引用（最多 2 个）→ 剥离 `[[素材:N]]` → 发送文本 → 发送素材 → 写上下文
- [ ] 7.5 长答案分段：>2048 字节按句号边界（。！？!?\n）切 ≤2000 字节多段，间隔 300ms 发送
- [ ] 7.6 创建 `apps/adapter/src/qa/qa.module.ts`：工厂根据 `USE_MOCK_LLM` 注入 `MockQaEngine` 或 `FastGPTQaEngine`
- [ ] 7.7 创建 `config/mock-qa.json` 工厂默认值（10 条，含分数）
- [ ] 7.8 单元测试：置信度 0.749/0.75 分界；素材引用 ≤2；长答案分段；双通道降级（mock 模式验证不抛异常）

---

## 8. M6 敏感词过滤

- [ ] 8.1 创建 `apps/adapter/src/filter/sensitive-filter.service.ts`：`SensitiveFilterService`，使用 `ahocorasick` 库构建 AC 自动机，`sweep(text)` 扫描并替换命中词为 `[内容已过滤]`，写审计日志（不含原文）
- [ ] 8.2 创建 `apps/adapter/src/filter/filter.module.ts`：`fs.watch` + 500ms 防抖热加载，`config/sensitive-words.txt` 原子替换引用
- [ ] 8.3 创建 `config/sensitive-words.txt` 出厂默认值（含 5–10 个占位词）
- [ ] 8.4 单元测试：命中/不命中/热切换原子性

---

## 9. M5 未命中记录

- [ ] 9.1 创建 `apps/adapter/src/miss/miss.service.ts`：`MissService`，异步入库（`setImmediate`），失败本地 FIFO 缓存 1000 条重试
- [ ] 9.2 创建 `apps/adapter/src/miss/miss-export.service.ts`：`MissExportService`，`exceljs.stream.xlsx.WorkbookWriter` 流式生成，userid 掩码（前 2 + ****）
- [ ] 9.3 创建 `apps/adapter/src/miss/miss.module.ts`；`@nestjs/schedule` 定时任务 03:30 清理 90 天前记录
- [ ] 9.4 创建 `apps/adapter/src/database/migrations/001-miss-record.sql`：DDL 含索引 `idx_miss_status_created`
- [ ] 9.5 单元测试：异步入库；导出格式；缓存重试逻辑

---

## 10. M8b 素材外发占位（不发文件，仅接口占位）

- [ ] 10.1 创建 `apps/adapter/src/media/asset-sender.service.ts`：`AssetSender` 类，`send(chatId, asset)` 方法含 link/file/video 三分支（file→uploadMedia→sendFile，video→uploadMedia→sendVideo，link→sendText），失败返回降级提示；接口存在但 `USE_MOCK_LLM` 模式下素材表数据为空时不报错
- [ ] 10.2 创建 `apps/adapter/src/media/media.module.ts`（占位，暂不注入到管道）

---

## 11. 管理面 API

- [ ] 11.1 创建 `apps/adapter/src/admin/admin.guard.ts`：Basic Auth 中间件 + IP 白名单（`ALLOWED_ADMIN_IPS` CIDR 解析）
- [ ] 11.2 创建 `apps/adapter/src/admin/miss.controller.ts`：`GET /admin/miss-records`（xlsx/json 导出）
- [ ] 11.3 创建 `apps/adapter/src/admin/config.controller.ts`：`GET /admin/config-check`（变量存在性+掩码）、`POST /admin/config/reload`（关键词+敏感词+可变配置热重载）
- [ ] 11.4 创建 `apps/adapter/src/admin/license.controller.ts`：`GET /admin/license`（含 mock 标识）、`POST /admin/license/reload`
- [ ] 11.5 创建 `apps/adapter/src/admin/admin.module.ts`
- [ ] 11.6 创建 `apps/adapter/src/health/health.controller.ts`：`GET /healthz`（Redis ping + PG ping + license cache 状态），返回 `{status:'ok'}` 或 503 `{status:'degraded', deps:[...]}`

---

## 12. 部署套件

- [ ] 12.1 创建 `deploy/docker-compose.yml`：6 服务（adapter/fastgpt/pg/mongo/redis/nginx），仅 nginx:443 映射宿主机；adapter 环境变量引用 `.env`；健康检查配置
- [ ] 12.2 创建 `deploy/nginx/nginx.conf`：TLS 终结（证书路径挂载），仅 443 对外，代理到 adapter:3000；请求体限制 10MB
- [ ] 12.3 创建 `deploy/Dockerfile.adapter`：三阶段构建（builder → native → runtime），runtime 用 `gcr.io/distroless/nodejs20-debian12:nonroot`；嵌入混淆产物
- [ ] 12.4 创建 `deploy/backup.sh`：pg_dump × 2、mongodump、assets 打包，保留 7 天，`set -e` 失败告警
- [ ] 12.5 创建 `deploy/logrotate.conf`：日志轮转（每天 + 100M 上限）
- [ ] 12.6 创建 `deploy/.env.template`（完整版，含增项变量注释）
- [ ] 12.7 验证：本地 docker compose config 无错误；healthz 在模拟环境下返回 200

---

## 13. 单元测试覆盖率

- [ ] 13.1 配置 jest：jest.config.cjs，含 `collectCoverageFrom`（管道模块 ≥80%、横切模块 ≥60%）、`coverageThreshold`
- [ ] 13.2 为每个模块写 spec 文件：wecom（含 3.5s 竞速模拟时钟）、routing（含令牌桶 Lua 脚本测试）、context（mock ioredis）、qa-orchestrator（mock engine）、filter、license（mock verifier）、miss（mock pg）、admin（supertest）
- [ ] 13.3 覆盖率报告：运行 `pnpm -C apps/adapter test -- --coverage` 验证达标

---

## 14. 端到端冒烟验证

- [ ] 14.1 Mock 模式端到端：起服务，模拟 POST `/wecom/callback` 触发一条消息，验证经过 dedup → routing → context → mock-qa → filter → sendText 完整链路，日志含 traceId
- [ ] 14.2 管理接口冒烟：`curl -u admin:pw /admin/config-check` 返回 `present:true`；`/admin/license` 返回 `valid:true, mock:true`
- [ ] 14.3 限流边界：灌入第 21 条群消息，验证第 21 条触发限流话术
- [ ] 14.4 敏感词替换：mock-qa 返回含敏感词的内容，验证被替换为 `[内容已过滤]`
