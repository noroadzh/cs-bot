# Proposal: cs-bot-mvp-foundation

## Why

需要将《微信群智能客服机器人 MVP》的需求文档（PRD V1.4）、概要设计（V1.8）和详细设计（V1.0）转化为可执行、可追踪的工程计划。基线 MVP 含 11 个模块（M1–M9 加管理面/部署），按"先 mock 后真实集成"的策略分阶段实现，为后续增项包（A/B/C/D）预留独立扩展路径。

## What Changes

基线 MVP 交付物：

1. **工程骨架**：pnpm monorepo，NestJS 10 + TypeScript，Docker Compose 完整模板（adapter / FastGPT / PostgreSQL+pgvector / Redis / MongoDB / nginx）。
2. **企微接入层（M1）**：回调验签（SHA1+AES解密）、XML 消息解析、被动回复（3.5s 竞速）与主动补发通道、WecomClient 统一封装（access_token 缓存+分布式锁）。
3. **消息路由层（M2）**：@机器人触发解析、关键词 Trie 匹配、消息去重（Redis SETNX 48h）、令牌桶限流（Lua 原子脚本）。
4. **会话上下文（M3）**：Redis JSON 数组，近 5 轮滑动窗口，TTL 600s 自动续期，fail-open 容错。
5. **问答编排（M4）**：引入 `IQAEngine` 接口，`MockQaEngine`（内置 10 条示例问答，配置化）+ `FastGPTQaEngine`（真实调用），通过 `USE_MOCK_LLM` 切换；置信度 0.75 阈值；长答案分段发送；素材引用解析（`[[素材:N]]`）；拒答话术。
6. **敏感词过滤（M6）**：AC 自动机（ahocorasick），`sensitive-words.txt` 热加载（fs.watch + 防抖 500ms），命中替换 + 审计日志。
7. **未命中记录（M5）**：异步入库（不阻塞管道），exceljs 流式导出 xlsx（userid 掩码），03:30 定时清理 90 天前记录。
8. **授权骨架（M9）**：引入 `ILicenseVerifier` 接口，`MockLicenseVerifier`（格式校验 + 返回 valid，`.env` 中 `LICENSE_FILE` 必须存在）+ `NativeLicenseVerifier`（Rust napi-rs Ed25519 验签，后续 change 注入），通过 `USE_MOCK_LICENSE` 切换；启动强校验；`POST /admin/license/reload` 热重载。
9. **管理面 API**：Basic Auth + IP 白名单；`/admin/miss-records`（xlsx/json 导出）、`/admin/keywords/reload`、`/admin/config-check`、`/admin/config/reload`、`/admin/license`（含 mock 标识）。
10. **配置管理（M7）**：ConfigService（zod 校验），fail-fast 启动；所有凭证（企微/FastGPT/LLM）存在性必校验，mock 模式不断网络。
11. **部署套件**：docker-compose.yml、nginx.conf（TLS 终结 + 仅 443 对外）、backup.sh（pg_dump + mongodump）、healthz 探针、.env 模板。

**非本期交付（增项包）**：`/admin/assets`（素材管理）、`/admin/import/*`（历史导入）、`/platform/*`（SaaS 控制面）、M8（多媒体识别）、Rust license-native 模块——均不写骨架。

## Capabilities

### New Capabilities

- `wecom-integration`：企微回调接入、消息加解密、消息收发、被动回复与主动补发竞速
- `message-routing`：@触发解析、关键词 Trie 匹配、去重、令牌桶限流
- `session-context`：Redis 会话上下文，5 轮滑动窗口，TTL 续期，fail-open
- `qa-orchestration`：问答编排流水线，IQAEngine 接口抽象，置信度判定，长答案分段，素材引用解析
- `mock-qa-engine`：MockQaEngine 实现，内置 10 条示例问答，支持运行时配置替换
- `sensitive-filter`：AC 自动机敏感词过滤，热加载，命中替换 + 审计
- `miss-record`：未命中异步落库，xlsx 流式导出，定时清理
- `license-skeleton`：ILicenseVerifier 接口，MockLicenseVerifier 实现，格式校验，启动强校验
- `admin-api`：Basic Auth + IP 白名单，miss-records / keywords / config / license 管理接口
- `config-management`：zod 校验的 ConfigService，fail-fast 启动，凭证存在性校验
- `deployment-suite`：docker-compose 模板，nginx TLS 反代，backup.sh，healthz，.env 模板

### Modified Capabilities

（绿地项目，无既有能力）

## Impact

- 新建 `apps/adapter/`（NestJS 适配层）、`packages/shared/`（共享类型/错误码/Result）
- 新建 `packages/license-native/` 占位目录（含注释说明后续注入 Rust 模块）
- 新增依赖：`@nestjs/core`、`fastify`、`ioredis`、`exceljs`、`ahocorasick`、`zod`、`pino`
- FastGPT 凭证必须写入 `.env`（存在性校验），但 mock 模式下不断网络调用
- `USE_MOCK_LLM=true`（默认）和 `USE_MOCK_LICENSE=true`（默认）贯穿配置层
- Docker Compose 增加 nginx / adapter / fastgpt / pg / mongo / redis 6 个服务定义
