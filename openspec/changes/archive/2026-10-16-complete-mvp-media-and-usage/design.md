# Design

## Context

基线 MVP 的 M1–M7、M9 已实现并通过测试。增项 A（多媒体）仅落地了目录骨架：`apps/adapter/src/media/` 下有 `asset-sender.service.ts`（22 行）与 `media.module.ts`，但缺少素材的存储层（`asset` 表）、管理端 CRUD 端点、图片识别链路。M8/D10（用量上报）只有 `USAGE_REPORT_ENABLED` 配置项，无任何实现代码。

现有约束：

- 消息管道单入口在 `apps/adapter/src/wecom/wecom.controller.ts`，所有出站文本经 `filter/sensitive-filter.service.ts`（架构规则 R-3）
- 出站素材发送已经抽象在 `media/asset-sender.service.ts`，`qa/qa-orchestrator.service.ts` 负责解析 `[[素材:<id>]]` 标记
- 管理端点统一在 `admin/` 模块，经 `admin.guard.ts` 做 Basic Auth + IP 白名单
- 数据库迁移以 `.sql` 文件形式随镜像分发（`COPY --from=builder /app/apps/adapter/src/miss/001-miss-record.sql`），无 ORM
- 配置经 `config/config.service.ts` 的 zod schema fail-fast 校验，新增环境变量必须进 schema

## Goals / Non-Goals

**Goals:**

- 让 `[[素材:<id>]]` 标记真正可用：素材有持久化存储、有管理端 CRUD、标记能解析到真实内容
- 让图片类消息进入问答管道：识别文本作为附加上下文，不阻断原有纯文本路径
- 给出可查询、可上报的用量数据，周期口径明确且重启不丢

**Non-Goals:**

- 不实现增项 B（历史导入）、C（SaaS 控制面）、D（本地模型）——这三项体量与本变更相差一个数量级，另起变更
- 不做素材的版本管理、审批流、CDN 分发
- 不做 token 的精确计费（无分词器），仅启发式估算，够用于运营观察而非计费依据
- 不引入 ORM 或迁移框架，沿用现有裸 SQL 文件模式

## Decisions

### D1: 素材存储沿用裸 SQL 文件迁移，不引入 ORM

新增 `apps/adapter/src/media/002-asset.sql`，定义 `asset` 表；Dockerfile 增加一行 `COPY` 把它带进 `/app/migrate/`。部署手册已有"执行 `/app/migrate/*.sql`"的流程，无需改部署逻辑。

**备选**：引入 Prisma/TypeORM 做 schema 迁移。否决——仓库只有一个 `pg` 依赖，miss_record 已是裸 SQL，引入 ORM 会连带改动 miss 模块与 Dockerfile builder 阶段，收益不匹配成本。

### D2: 素材文件名用生成的 id，不用上传时的原始文件名

`asset.id` 为 `randomUUID()`，文件落盘路径是 `data/assets/<id>`（无扩展名），`name` 列保存原始文件名用于展示。这样路径穿越（`../../etc/passwd`）在结构上不可能发生——不需要对 filename 做清洗或 `path.basename` 兜底。type 为 `link` 的素材不落盘，只存行。

**备选**：用原始文件名落盘 + `path.basename()` 清洗。否决——仍需保留 name 到某处，且同一 name 重复上传要处理冲突；生成 id 把这两个问题一起消掉。展示层用 `name` 列即可。

### D3: 上传限制用 Nest 的 `FileInterceptor` + 显式检查，不用全局 pipe

`POST /admin/assets` 接受两种形态：multipart（`file` 字段）和纯 JSON（`{type,url,name}`，用于链接型素材）。用 `FileInterceptor` 拿到 `{size, mimetype, originalname, buffer}`，在 service 内检查大小与 MIME。

**备选**：用 `express-fileupload` 或 `multer` 磁盘存储。否决——多一个依赖，且 Express 5 与 multer 的兼容性要额外验证；`FileInterceptor` 内存缓冲对 20MB 上限足够。

MIME 白名单：文件型 `application/pdf, application/msword, application/vnd.openxmlformats-officedocument.*, application/vnd.ms-excel, text/*, image/png, image/jpeg`；其余类型用 415 拒绝。

### D4: 用量计数放内存，周期切换时重置，落盘快照只保一份

`UsageService` 持一个 `counters` 对象。周期口径按 `USAGE_PERIOD` 决定（日/周/月），定时器检查当前周期 key 是否与 `counters.period` 一致，不一致则重置并重写。快照每 60s 写 `data/usage-snapshot.json`，启动时读回——同周期恢复，跨周期丢弃。

**备选**：计数落 PG，用 SQL 聚合。否决——每次计数都要写库，而用量是运营观测指标不是业务数据，写库会让高 QPS 下的管道受计费写入拖累；快照一份 JSON 足够，重启丢失的窗口（最多 60s）可接受。

**备选**：Redis 计数。否决——Redis 已有 `context` 在用，但用量周期与上下文 TTL 语义无关，混用会让 `flush` 语义变复杂，且 mock 模式（`USE_MOCK_LLM=true`）下不启 Redis。

### D5: 素材发送失败不影响文本回复

`qa-orchestrator` 里素材发送包 try/catch，失败只 log 带错误码，不抛出、不重试。理由：文本回答已经送达用户，素材失败不应把整条消息标成失败（那会让 `messages.answered` 计数错乱）。

### D6: 图片识别在路由层之前注入，不在 QA 层

`wecom.controller` 解析出消息后，若含 image 类型消息，先过 `MediaRecognizeService`，把结果以 `【图片识别】<desc>` 前缀拼到 question 上，再进 `routing`。这样关键词触发匹配到的是富化后的文本，符合"用户在描述里 @ 机器人问价格"的实际用法。

**备选**：在 `qa-orchestrator` 内部调识别。否决——那样关键词触发（trigger）在识别之前就判完了，带图片的消息会因为正文为空而不触发，等于识别白做。

### D7: 识别服务失败一律降级为空串，不抛错

超时、非 2xx、media_id 无效都返回空串并 log。识别是增强项不是前置条件，失败就退回纯文本路径。

**备选**：识别失败则整条消息不回答。否决——用户在群里发图 + 提问，如果因为识别服务抖动就完全不回复，体验退化比"少了图里的信息"严重得多。

### D8: token 用 `Math.ceil(len/2)` 启发式

不引分词器。`len/2` 对中英混排的误差在运营观察场景可接受，明确在响应里标注 `estimated: true`，避免被当成计费依据。

### D9: 新增环境变量进 config schema 且必填校验

`QWEEN_VL_BASE_URL`（url）、`QWEEN_VL_API_KEY`（min 8）、`MAX_ASSET_BYTES`（default 20971520）、`USAGE_WEBHOOK_URL`（optional，默认空）、`USAGE_REPORT_INTERVAL_MS`（default 86400000）、`USAGE_PERIOD`（enum daily/weekly/monthly，default daily）。除 `USAGE_WEBHOOK_URL` 外都需在 mock 模式下也有合法默认值，保证 `USE_MOCK_LLM=true` 的开发流程不被破坏。

注意：配置项命名用 `QWEN_VL_*`（通义千问 qwen-vl），不是 `QWEEN_VL_*`——spec 里已按 `QWEN_VL_*` 写，实现时对齐。

## Risks / Trade-offs

- **[Dockerfile 漏改导致 002-asset.sql 不进镜像]** → tasks 里把 Dockerfile 的 `COPY` 行作为独立任务项并单独验证镜像内 `/app/migrate/` 有两个文件
- **[`asset` 表在已部署环境不存在导致运行时报错]** → 迁移 SQL 用 `CREATE TABLE IF NOT EXISTS`；部署手册补一行按序执行 `ls /app/migrate/*.sql`
- **[in-memory 计数在多副本部署下不准]** → MVP 是单副本部署（compose 单 adapter 容器）。若将来多副本，需要换 PG/Redis 计数，此为已知边界，写进 spec 的 Non-Goals
- **[识别服务引入新的出站依赖与延迟]** → 复用 `LLM_TIMEOUT_MS`（15s）作为上限；实测超时会显著拖慢该条消息的处理，考虑后续把识别改为异步补发
- **[`FileInterceptor` 内存缓冲 20MB × 并发上传]** → admin 端点受 IP 白名单保护，外部无法触达，风险可接受
