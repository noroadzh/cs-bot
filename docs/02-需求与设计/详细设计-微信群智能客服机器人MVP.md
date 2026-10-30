# 微信群智能客服机器人 MVP — 详细设计文档

| 项 | 内容 |
|---|---|
| 文档名称 | 详细设计说明书（内部工程文档，不对外交付） |
| 版本 | V1.17（V1.16 + 全量核对：置信度归零与各节表述） |
| 日期 | 2026-10-29 |
| 状态 | 待评审 |
| 适用读者 | 全栈工程师（直接据此编码） |
| 上游文档 | 《概要设计 V1.26》（模块 M1–M11、数据流 D1–D10、规则 R-1~R-8、ADR A1–A14）、《PRD V1.5》、《部署手册 V1.14》 |
| 设计基线 | NestJS 10 / Node 20 / TS 5.x；FastGPT v4.8.x；PG15+pgvector；Redis7；Mongo6；Rust(napi-rs) 授权核心 |

> 约定：本文所有接口/类型以 TypeScript 表达；`adapter` 指自研适配层服务；所有时间戳为 `timestamptz`；所有 ID 字符串不含敏感信息。与概设冲突时以概设为准并回报修订。

---

## 1. 工程组织与设计总则

### 1.1 代码仓库结构（monorepo，pnpm workspace）

```
cs-bot/
├── apps/
│   └── adapter/                 # 适配层（NestJS，消息管道 + 管理面）
│       ├── src/main.ts          # 数据面入口（config → redis/pg 探活 → Nest → listen）
│       ├── src/control-plane/   # 平台控制面模块（仅 SaaS 启用）
│       └── src/control-plane-main.ts  # 控制面独立入口（与数据面共用镜像）
├── packages/
│   ├── shared/                  # 共享：类型、错误码、Result、脱敏工具
│   └── license-native/          # Rust napi-rs 源码与 .node 预编译产物
├── deploy/                      # compose（基线 + SaaS 叠加）、nginx、install/collect 脚本
└── tools/                       # 签发工具（license-issuer，仅交付方内部使用）
```

> 控制面与数据面**同一镜像、两个入口**：`main.ts` 挂载完整 `AppModule`；`control-plane-main.ts` 只挂载 `ControlPlaneAppModule`（独立端口 3100、独立数据库与鉴权）。不单独构建 `apps/control-plane` 包。

### 1.2 adapter 模块划分（与概设 M1–M11 对应）

```
apps/adapter/src/
├── main.ts            # 数据面入口：config fail-fast → redis/pg 探活 → Nest → listen
├── control-plane-main.ts  # 控制面入口（独立端口/DB/鉴权）
├── wecom/        (M1)  # WecomController + WecomCrypto + WecomClient
├── routing/      (M2)  # TriggerService + RateLimiter + DedupService + KeywordTrie
├── context/      (M3)  # ContextService（Redis 上下文）
├── qa/           (M4)  # QaOrchestrator + FastGPTClient + FastGPT/Mock 引擎 + LlmAlert
├── miss/         (M5)  # MissService + MissExportService(xlsx/json) + MissCleanup
├── filter/       (M6)  # SensitiveFilterService(Aho-Corasick) + 词库热加载
├── config/       (M7)  # ConfigService(zod 校验) + 配置 DTO
├── admin/              # 管理面控制器（miss/assets/import/license/usage/config-check）
├── health/             # HealthController（依赖探活 + license + usage + resources）
├── media/        (M8)  # MediaRecognizeService + AssetService + AssetSender + 引用解析
├── license/      (M9)  # LicenseService + native/mock verifier + Gate + 运行期调度
├── import/       (M10) # ImportJobService + 解析器 + 配对 + 审核/回滚 + 清理
├── usage/        (D10) # UsageService + Reporter + CapacityUsage/Guard + Webhook
├── platform/     (M11) # 租户/配额/订阅/升级/审计/监控/密钥/注销 + provisioner
├── control-plane/      # 控制面应用装配与独立配置
├── internal/           # 内部接口（/internal/tenant/sync）
├── common/             # 日志、脱敏、信号量、资源指标、异常过滤器、请求上下文
└── types/              # 全局类型声明
```

依赖方向以模块划分与代码评审保证（`wecom → routing → license → context/media → qa → filter → wecom`；横切 `miss/config/admin/health` 被引用不引用管道模块；禁止反向 import）。当前仓库未配置 ESLint 边界规则，`nx/enforce-module-boundaries` 为后续可选项。

### 1.3 分层约定

每个模块内：`Controller/entrypoint → Service（业务） → Client/Repository（外部 IO）`。Service 纯业务可单测；外部 IO（HTTP/Redis/PG/Rust）全部经 Client/Repository 接口注入，单测用内存 stub。

### 1.4 统一返回与错误码

**内部 Result**（`packages/shared/src/result.ts`）：

```ts
export class Ok<T> { readonly ok = true as const; constructor(readonly value: T) {} }
export class Err<E = unknown> { readonly ok = false as const; constructor(readonly error: E) {} }
export type Result<T, E = unknown> = Ok<T> | Err<E>;
```

**流水线错误码**（`packages/shared/src/errors.ts`，数值枚举，五位分段）：

| 段 | 枚举 |
|---|---|
| 10000 企微 | `WECOM_SIGN_INVALID=10001`、`WECOM_DECRYPT_FAIL=10002`、`WECOM_SEND_FAIL=10003`、`WECOM_UPLOAD_FAIL=10004` |
| 20000 路由 | `NOT_TRIGGERED=20001`、`DEDUP_DUP=20002`、`RATE_LIMITED=20003`、`ROUTING_ERROR=20004` |
| 30000 编排 | `LLM_TIMEOUT=30001`、`ORCHESTRATION_ERROR=30002` |
| 40000 过滤 | `SENSITIVE_HIT=40001` |
| 50000 素材 | `ASSET_NOT_FOUND=50001`、`ASSET_SEND_FAIL=50002` |
| 90000 授权 | `LICENSE_RESTRICTED=90001`、`LICENSE_EXPIRED=90002`、`LICENSE_INVALID=90003` |

**管理面 / 平台业务错误码**（响应体 `errCode` 为字符串常量，按模块前缀）：

| 前缀 | 示例 |
|---|---|
| 鉴权 | `AUTH_UNAUTHORIZED`、`AUTH_FORBIDDEN`、`INTERNAL_TOKEN_NOT_CONFIGURED`、`PLATFORM_REASON_REQUIRED` |
| 素材 | `NO_FILE`、`ASSET_TOO_LARGE`、`ASSET_NOT_FOUND`、`MISSING_REQUIRED_FIELDS`、`UNSUPPORTED_MEDIA_TYPE` |
| 导入 | `IMPORT_NO_FILE`、`IMPORT_FILE_TOO_LARGE`、`IMPORT_FETCH_FAILED`、`IMPORT_BAD_STATE`、`IMPORT_BUSY`、`IMPORT_DUPLICATE_ITEM`、`IMPORT_MANIFEST_EXPIRED` 等 20+ 项 |
| 平台/租户 | `TENANT_NOT_FOUND`、`TENANT_QUOTA_EXCEEDED`、`TENANT_QUOTA_INVALID`、`TENANT_SECRETS_MISSING`、`TENANT_PROVISION_TIMEOUT`、`TENANT_CREDENTIALS_ALREADY_HANDED_OFF`、`ILLEGAL_TENANT_TRANSITION`、`CAPACITY_USAGE_UNAVAILABLE` 等 |
| 兜底 | `INTERNAL_ERROR`（未捕获异常，500） |

完整清单以 `apps/adapter/src/**` 中 `errCode:` 字面量与 `errors.ts` 为准（当前字符串码 55 项）。

错误处理三原则：① 可预期业务分支记 INFO 级结构化日志，不打堆栈；② 外部 IO 错误按概设降级矩阵处理并 WARN；③ 未捕获异常由全局 ExceptionFilter 兜底回 `INTERNAL_ERROR`（防企微重推风暴）+ ERROR 日志。

### 1.5 日志规范（结构化 JSON，pino）

- **基础字段**：`app / version / env / pid / module / traceId`（请求内自动注入）；`traceId` 贯穿 D1–D9。
- **业务字段**：`chatHash / userHash`（对 chatId/userId 做哈希，不落原始值）、`errCode`、`costMs`、`action`、`detail`。
- **脱敏（所有级别生效）**：pino `redact` 覆盖 `authorization/password/secret/token/licenseKey/question/answer/content/text/reply`；字符串另经 `maskPIIPatterns`（手机号/身份证/银行卡/邮箱等）与 `maskPII` 中段掩码。
- **级别**：`LOG_LEVEL` 控制；`/healthz`、`/docs` 访问日志降为 debug；慢操作由 `SLOW_LOG_MS` 触发 `slow` 标记。

### 1.6 配置规范（M7 落地）

- `.env` → `ConfigService`，启动时用 **zod schema** 全量校验：必填缺失/格式错误 → 打印缺失清单（值打码）→ `process.exit(1)`（fail-fast）。
- `GET /admin/config-check` 返回：

```json
{ "mode": { "useMockLlm": false, "useMockLicense": false },
  "config": { "WECHAT_CORP_ID": { "present": true }, "FASTGPT_API_KEY": { "present": true, "masked": "fa****ey" } } }
```

- 运行期可变项（阈值/超时/话术）支持 `POST /admin/config/reload` 热加载（词库/关键词/导入规则同法）。

---

## 2. 公共组件详细设计

### 2.1 出站客户端与并发控制（实际形态）

出站调用由各客户端自行持有 `axios` 实例，不设统一 `HttpClient` 抽象；三层共性能力如下：

| 能力 | 实现 | 说明 |
|---|---|---|
| 实例与超时 | `axios.create({ baseURL, timeout })` | WecomClient 10s；FastGPT 主/备各一实例；VL 10s |
| 资源水位 | `apps/adapter/src/common/resource-metrics.ts` | `/healthz` 输出 `resources.{cpuPct,memPct}`：cgroup v2/v1 内存占用比，CPU 用 loadavg/核数；异常时返回 0 |
| 并发上限 | `apps/adapter/src/common/semaphore.ts` | FIFO 信号量：`LLM_CONCURRENCY=4`、`WECOM_CONCURRENCY=8`、`VL_CONCURRENCY=2`（可配） |
| 重试 | 客户端内建 | 企微发送 `WECOM_SEND_MAX_ATTEMPTS=3` + 退避；FastGPT 失败退避 `LLM_RETRY_DELAY_MS=1000` 后重试 1 次；同幂等请求才重试 |

各客户端直接 `await llmSemaphore().run(() => ...)` / `wecomSemaphore().run(...)` / `vlSemaphore().run(...)` 包裹请求。

> 历史设计曾规划统一 `HttpClient.request({ retries, backoffBaseMs, semaphore })`；实际实现按客户端拆分（V1.4 起文档以实际形态为准），语义等价：并发受同一信号量约束、重试仅对幂等请求。

**FastGPT 出口统一**（R-2）：`apps/adapter/src/qa/fastgpt.client.ts` 的 `FastGPTClient` 是唯一 FastGPT 访问入口，提供 `chat` / `ensureDataset` / `writeBatch` / `deleteDatasetById` / `searchTest` / `collectionCount`，统一 base URL（去尾斜杠）、`Authorization`、超时与响应解析。M4 问答引擎、M10 数据集写入与近似检索、用量统计的 collection 计数均注入该客户端（测试可注入 axios 实例或 fake）。

### 2.2 WecomClient（M1 出站，R-1 唯一企微出口）

| 方法 | 封装的企微 API | 说明 |
|---|---|---|
| `sendText(chatId, content, atUser?)` | appchat/send | 群文本 + @ 提问人（atuserlist） |
| `sendFile(chatId, mediaId)` | appchat/send(msgtype=file) | 素材文件消息 |
| `sendVideo(chatId, mediaId, title)` | appchat/send(msgtype=video) | 素材视频消息 |
| `uploadMedia(type, path)` | media/upload | 临时素材 3 天有效，失败重传 1 次 |
| `downloadMedia(mediaId)` | media/get | ≤10MB 图片下载到临时区 |
| `getAccessToken()` | gettoken | 内存缓存 7000s，失败刷新重试 |

access_token 刷新加分布式锁（Redis SETNX，双实例部署时防并发刷新）；缓存剩余 <300s 即视为过期提前刷新（概设 M1）。

### 2.3 FastGPT 客户端（R-2 唯一 FastGPT 出口）

实现：`src/qa/fastgpt.client.ts` 的 `FastGPTClient`（统一 base URL/鉴权/超时/响应解析）。

```ts
class FastGPTClient {
  chat(body: { chatId?; question; history?; datasetIds? }): Promise<{ answer; quotes; score }>;
  ensureDataset(name: string): Promise<string>;                       // M10
  writeBatch(datasetId: string, pairs: DatasetQaPair[]): Promise<string[]>;
  deleteDatasetById(datasetId: string): Promise<void>;                // M10 回滚
  searchTest(question, { datasetIds?, limit? }): Promise<SearchHit[]>; // M10 近似去重
  collectionCount(datasetId: string): Promise<number>;                // 用量统计 docCount
}
```

- `chat`：POST `/api/v1/chat/completions`，解析 `choices/data` 与 `responseData[].quoteList`；超时取 `LLM_TIMEOUT_MS`（默认 15s），重试 1 次由调用方（引擎）控制。
- 置信度：`score = max(quoteList[].score)`；无引用时透传 `data[0].score`，皆无则 **0**（走拒答与未命中记录，符合 `qa-orchestration` 规格）。
- 数据集写/删由 `HttpFastGptDatasetClient` 委托；近似检索由 `HttpFastGptSearchClient` 委托；三者共享同一凭据与 base URL。
- 测试可注入 `FastGPTClient` 或裸 axios 实例。

### 2.4 license-native（Rust，M9 核心，R-1 例外说明）

接口以 `packages/license-native/index.d.ts` 为准：

```ts
// 验签 + 过期 + 空指纹检查（不绑定机器指纹，绑定由调用方做）
verify(payloadJson: string, sigB64: string): VerifyResult
// 采集并哈希宿主指纹（Linux；非 Linux 抛 GenericFailure）
fingerprint(): string
// 反回放：以 statePath 推进时间戳；now <= 上次记录 → ok:false 且不写文件
antireplay(statePath: string | null, now: number): AntireplayResult
// 反调试自检：debugPort(9229) / TracerPid / LD_PRELOAD
selfcheck(): SelfcheckResult
```

返回结构：

| 类型 | 字段 |
|---|---|
| `VerifyResult` | `valid: boolean`、`reason`（valid / bad-format / bad-payload / bad-signature / expired / empty-fingerprint / not-embedded / native-error）、`fingerprint`、`expiresAtMs`、`daysLeft`、`maxChats` |
| `AntireplayResult` | `ok`、`advanced`、`lastTs` |
| `SelfcheckResult` | `clean`、`evidence: string[]` |

- 产物 `index.linux-x64-gnu.node`，strip + 无调试符号；公钥编译期内嵌。
- license.lic 格式：`base64(payload JSON) + "." + base64(Ed25519 signature)`（类 JWT 紧凑形式）。
- 调用方 `NativeLicenseVerifier` 负责组合：`selfcheck` → `verify` → `fingerprint()` 与 `payload.fingerprint` 比对 → `antireplay`。

---

## 3. 模块详细设计

### 3.1 M1 企微接入（wecom/）

**回调入口** `POST /wecom/callback`

```
1. 取 query: msg_signature, timestamp, nonce, echostr(首次验证)
2. echostr 存在 → VerifyURL（仅验签解密回显）→ 200 明文 echostr
3. 解密流程（严格官方 WXBizMsgCrypt）：
   s = AESDecrypt(Base64(EncodingAESKey), Encrypt)      // 16B 随机串|msg_len|msg|receiveid
   校验 receiveid == CorpID，msg_len 一致性
   SHA1(sort(token, timestamp, nonce, Encrypt)) == msg_signature，否则 `WECOM_SIGN_INVALID` → 401
4. 解析 XML → InboundMsg{ ToUserName, FromUserName(userid), ChatId(群), MsgType,
   Content?, MsgId?, MediaId?, PicUrl?, CreateTime }
5. 立即回 HTTP 200 空体（群聊无被动回包，答案经主动发送，见下）
6. 投递管道（异步，不阻塞回调线程）：pipeline.process(msg)
```

**主动发送**：群聊场景答案就绪后由 `WecomClient.sendText` 主动发送（`client_msg_id = traceId` 幂等）；单聊/应用消息场景才保留 3.5s 被动竞速（超时回 `success` 后补发）。

**去重（D2 前置）**：`SETNX dedup:{msgid} EX 172800`，返回 0 → 直接终止（`DEDUP_DUP`）。

### 3.2 M2 路由触发（routing/）

**触发判定（顺序短路）**

```
isSelfOrBot(msg)            → 静默（机器人自身/其他应用消息）
msgType != text && !mentioned → 静默（未@多媒体，R 与 FR-9 一致）
mentioned = parseMention(Content)   // 企微 @ 列表含应用 userid/@昵称
keywordHit = KeywordService.match(text)  // keywords.yml 词表，Trie 前缀匹配
mentioned || keywordHit → 进入管道；否则静默（`NOT_TRIGGERED`）
```

**限流（按分钟固定窗口，Redis Lua 原子）**

| 键 | 速率 | 超限行为 |
|---|---|---|
| `rate:group:{chatId}:{minute}` | 20/min | 静默；同群每 5min 最多一次提示（`rate:hint:{chatId}`，300s NX） |
| `rate:user:{chatId}:{userId}:{minute}` | 5/min | 回"提问太频繁"话术 |

Lua 脚本（`LUA_TOKEN_BUCKET` 常量，语义为固定窗口计数）：`INCR` + 首次 `EXPIRE 60` 原子化，避免竞态；先查用户维度再查群维度。

**关键词配置** `config/keywords.yml`：`keywords: [/客服, 请问：, 咨询：]`；`POST /admin/keywords/reload` → 重建内存 Trie（原子引用切换，读写锁）。

### 3.3 M3 会话上下文（context/）

- Redis 结构：`ctx:{chatId}:{userId}` = JSON 数组（近 5 轮 `[{"q","a"}...]`），TTL 600s，每轮写入后 `EXPIRE` 续期。
- 超过 5 轮：截断保留最近 5 轮（数组 shift 最旧），整体写回并续期。
- 读失败（REDIS_FAIL）→ fail-open 返回空历史（A5 决策），WARN。

### 3.4 M4 问答编排（qa/）

```
answer = await FastGPTClient.ask({ question, history: ctx.history })
score = answer.quotes.length ? max(quote.score) : 0
if (score < CONFIDENCE_THRESHOLD /*0.75*/) {
    miss.record({ question, chatId, userId, score, mediaType })
    replyText = REFUSAL_TEXT         // "抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。"
} else {
    replyText = compose(answer.answer, quotes)   // 答案 ≤2000 字分段 + 「来源：xx.pdf」
    assets = parseAssetRefs(replyText)            // /\[\[素材:([a-f0-9-]+)\]\]/g，≤2 个（FR-10）
    replyText = stripAssetRefs(replyText)
}
final = SensitiveFilter.sweep(replyText)          // 命中 → 整段替换 + 审计
ctx.append({q: question, a: final})
send(final)；随后按 assets 逐个 AssetSender.send()（增项 A，失败降级提示）
```

- 长答案分段：>2048 字节按句号边界切 ≤2000 字节多段，间隔 300ms 发送（防频控）。
- `LLM_TIMEOUT`（双通道失败）：繁忙话术 + `LlmAlertService` 告警（企微群 webhook，冷却期去重）。

### 3.5 M5 未命中记录（miss/）

- 写入：异步队列（不阻塞管道），失败本地缓存 1000 条重投。
- 导出 `GET /admin/miss-records?from&to&format=xlsx`：流式生成 xlsx（exceljs `writeToBuffer`），`userid` 掩码（前 2 + ****）；响应头 `Content-Disposition: attachment`。
- 清理：每日 03:30 删除 `created_at < now()-90d`（可配），失败 WARN 次日重试。

### 3.6 M6 敏感词过滤（filter/）

- 数据结构：**AC 自动机**（Aho-Corasick，双数组实现 ~300 行或用 `ahocorasick` 成熟库）；构建耗时万级词 <50ms。
- 热加载：`fs.watch(sensitive-words.txt)` → 防抖 500ms → 构建新自动机 → 原子替换引用（旧实例等 GC，正在进行的 sweep 用旧表完成，无撕裂）。
- 命中行为：返回替换文本 + `audit` 日志（`{hitWord, chatId, userIdHash, ts}`，不含原文全文）。

### 3.7 M8 多媒体与素材（media/，增项 A）

**图片识别（qwen-vl）**

```
1. downloadMedia(msg.MediaId) → /tmp/{msgid}.jpg（≤10MB，企微 3 天有效期内）
2. VL 调用（固定提示词，DASHSCOPE_API_KEY，超时 10s）：
   prompt = "识别图片中的文字内容并归纳为一句咨询问题；若图片无有效文字/内容，仅输出 [NO_TEXT]"
3. resp 含 [NO_TEXT] 或空 → 引导话术（VL_NO_TEXT）
4. 识别文本 → 作为 question 走 M3/M4 正常链路；全程走主动补发通道（不占 3.5s 被动窗口）
```

**素材管理**：`POST /admin/assets`（multipart `file` 或 JSON `{url,name}`；类型由 MIME/来源推断）→ 校验大小（file≤20MB/video≤10MB）与 md5 去重 → 存 `data/assets/{id}.{ext}`（0600）+ asset 表入库。
**素材外发**：`AssetSender.send(chatId, asset)`：link→sendText（title+URL）；file/video→uploadMedia→sendFile/sendVideo；失败→补发降级提示 + WARN（`ASSET_SEND_FAIL`）。

### 3.8 M9 授权许可（license/）

**启动强校验（`AppModule.onModuleInit` → `LicenseService.startupCheck()`，Nest 初始化期，早于 HTTP listen）**

```
ConfigService.initialize()
→ Redis 探活 → PG 探活
→ NestFactory.create(AppModule)            // 期间触发 AppModule.onModuleInit
     → LicenseService.startupCheck()
         1) native.selfcheck() → clean=false 时记录 evidence（production exit(1)）
         2) doVerify(): 读 license/license.lic → verify() → 指纹比对 → antireplay(statePath, now)
         3) 缓存 {valid, reason, expiresAtMs, daysLeft, maxChats}，TTL 1h
         4) production 且 !valid → exit(1)；mock 模式仅 warn
→ Swagger / app.listen
```

**运行期**：Guard 在管道 D3 位读缓存（<1ms）；每日 03:00 复核 + 写 `license.lic.antireplay.json {lastTs}`（0600）。失效→受限模式：`/healthz` unhealthy、回调只回授权话术（`LICENSE_RESTRICTED`），FastGPT 后台不受限。
**群数上限**：运行时新群准入校验（`licensed_chat` 已授权群数 ≥ `maxChats`）→ 拒新群 + 告警；老群不受影响。
**续期**：`POST /admin/license/reload` 重跑校验并刷新缓存。

### 3.9 M10 历史导入（import/，增项 B）

**任务状态机**：`uploaded → parsing → parsed → {approved | partial | rejected | rolled_back} | failed`（任一步失败可 `retry`，幂等按条目级 `source_hash`）。内部阶段（文件校验/配对/入库）通过 `total_msgs/parsed_msgs/masked/blocked/dedup/approved/imported/failed` 计数表达，不额外引入对外状态值（契约冻结）。

**解析器接口**

```ts
interface SessionParser {           // 实现：csvParser / jsonlParser / txtParser（文本）+ xlsxParser（Buffer）
  parse(stream, onBatch: (msgs: RawMsg[]) => Promise<void>): Promise<{total: number}>
}
// RawMsg = { ts, sessionId?, speakerRole: 'customer'|'agent', text, msgType }
```

**QA 配对算法（核心）**

```
1. 按 (sessionId) 分组；组内按 ts 排序
2. 会话窗口切分：相邻消息间隔 > 30min → 新窗口
3. 窗口内：连续 customer 消息聚合为 Q（拼接，去重空格）；
   随后首条 agent 实质回复（len>=6 && 非纯表情/感谢词表）为 A；
   后续 agent 消息若中间无新 customer 提问 → 覆盖 A（多轮合并取末条结论）
4. 无 A 的 Q / 无 Q 的 A → unpaired（人工补配，不入库）
```

**脱敏（内置正则 + `config/import-names.txt` 姓名词典；`import-rules.yml` 负责清洗规则）**

| 规则 | 正则（示例） | 替换 |
|---|---|---|
| 手机号 | `1[3-9]\d{9}` | `[手机号]` |
| 身份证 | `\d{17}[\dXx]` | `[身份证号]` |
| 银行卡 | `\d{16,19}`（Luhn 校验通过） | `[银行卡号]` |
| 地址 | `(省|市|区|路|号|栋|室)` 组合模式 | `[地址]` |
| 姓名 | 标签（姓名/联系人/收货人）+ 词典匹配（最长优先） | `[姓名]`/`<NAME:n>` |

**入库/回滚**：`confirm` → 通过条目按 50 条/批 `FastGPTClient.upsertQa('历史语料-{jobId}')`，失败退避重试 3 次；`rollback` → `deleteDataset`。

**资源保护（R-8）**：进程内 `ImportTaskQueue`（FIFO + 单消费者）；每批（≤2000 条）后检查「RSS 增量 >200MB 或 RSS >80% `IMPORT_MEMORY_LIMIT_MB`」，超阈值时每 5 秒轮询内存、降回后立即继续；管理接口轮询进度。

### 3.10 M11 控制面（control-plane/，增项 C）

**Provisioner 状态机**：`alloc_slot → render_templates → init_db → issue_cert → sign_license → compose_up → healthcheck → register(active)`；任一步失败 → `rollback_steps`（已创建资源逆序删除）+ 状态 failed + 审计记录。

**编排渲染**：`ShellProvisioner.render()` 内联生成每租户 `docker-compose.yml`（无独立模板文件）；端口取 `tenant_port_seq`（30000 起、步长 10，管理口占用 port+1），项目/网络为 `csbot-t-<id>` / `csbot-t-<id>-net`，租户内 PG 库为 `csbot`；证书：通配证书复用（SNI）或 per-tenant ACME。

**用量上报（D10）**：adapter 每日 02:30 `POST {CONTROL_PLANE_URL}/report`，body 仅计数：`{tenantId, date, msgsIn, triggered, hit, miss, tokens, activeChats, docCount, qaCount, assetMb}`；失败本地缓存 7 天后丢弃（不影响问答）。

**订阅状态机迁移**：每日 09:00 扫描 `expired_at`：T-30/15/7 通知；到期→grace；grace+7d→suspended（向实例签发过期证书或置 license 失效）；续费→`renew`（签新证书 + 实例 reload）。

---

## 4. 数据库结构（以迁移为准）

数据库结构由**追加式编号迁移**定义：`apps/adapter/src/**/NNN-*.sql`（全新安装由 compose 挂载到 `docker-entrypoint-initdb.d/`，存量升级执行镜像内 `/app/migrate/*.sql`）。本节不再重复维护 DDL，避免与迁移漂移。

| 领域 | 迁移文件 | 主要表 |
|---|---|---|
| 未命中 | `miss/001-miss-record.sql`、`miss/009-miss-media-status.sql` | `miss_record`（+ media_type/status） |
| 素材 | `media/002-asset.sql`、`media/010-asset-md5.sql` | `asset`（+ md5） |
| 授权 | `license/003-licensed-chat.sql` | `licensed_chat` |
| 导入 | `import/004-import-job.sql`、`005-approved-qa.sql`、`006-import-job-stored-path.sql`、`007-import-pipeline.sql`、`013-import-message-stage.sql`、`014-import-dedup-counters.sql` | `import_job`、`import_item`、`approved_qa` |
| 平台 | `platform/007-tenant.sql`、`008-control-plane.sql`、`011-usage-counters.sql`、`012-tenant-ports.sql`、`015-tenant-offboarding.sql`、`016-runtime-gaps.sql`、`017-tenant-contact.sql` | `tenant`、`tenant_quota`、`tenant_usage_daily`、`platform_audit_log`、`tenant_snapshot`、`tenant_upgrade_batch`、`tenant_offboarding`、`tenant_destroy_confirmation` |

> 字段摘要见概设 §7.1（适配层）与 §7.4（平台侧）；`scripts/check-migrations.sh` 校验每个迁移都被部署配置引用。

## 5. Redis 键总表

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `dedup:{msgid}` | string "1" | 172800s | 消息幂等（D2 前置，SET NX） |
| `ctx:{chatId}:{userId}` | JSON array | 600s | 会话上下文（M3） |
| `rate:group:{chatId}:{minute}` / `rate:user:{chatId}:{userId}:{minute}` | counter | 60s | 按分钟固定窗口限流（M2，INCR + EXPIRE） |
| `rate:hint:{chatId}` | string "1" | 300s | 限流提示去重（同群每 5 分钟最多一次） |
| `wecom:at` / `wecom:at:lock` | string | 7000s / 短锁 | access_token 缓存与刷新锁（M1） |

> 授权状态为进程内缓存（每日 03:00 复核并写 `license.lic.antireplay.json`）；导入任务队列为进程内 `ImportTaskQueue`；用量上报失败缓冲落盘 `data/report-buffer.json`（保留 7 天）。三者均不使用 Redis。

## 6. API 契约（管理面，Basic Auth + IP 白名单）

> 交付形态：本期管理面**只有 API**（无自研前端），随《操作手册》附 curl / 表单调用示例；知识运营界面由 FastGPT 自带后台承担。下述接口契约在二期独立运营后台中**原样复用**（二期仅叠加前端与权限），因此本节的 URL/入参/出参视为冻结契约，二期不得破坏性变更。

### 6.1 未命中导出
`GET /admin/miss-records?from=2026-10-01&to=2026-10-11&format=xlsx` → `200 application/vnd.openxml…`（流式 xlsx）；`format=json` → `{total, items:[{question, chatId, score, mediaType, status, createdAt, userId}]}`；`userId` 经共享掩码函数（首 2 + `***` + 末 2），响应不含原始 `user_id`/`trace_id`/`engine`。

### 6.2 素材（增项 A）
```
POST /admin/assets            multipart file → 201 {success,asset}
                              或 JSON {url,name} → 201 {success,asset}
GET  /admin/assets?limit&offset → {success,total,limit,offset,assets:[{id,type,name,url,size,createdAt}]}
GET  /admin/assets/:id        → {success,asset}（404 ASSET_NOT_FOUND）
DELETE /admin/assets/:id      → {success:true,deleted:true}（删除记录与落盘文件）
```

### 6.3 导入（增项 B）
```
POST /admin/import-jobs                   multipart file → 201 {id,name,sourceFilename,status:"uploaded"}
POST /admin/import-jobs/from-url          {url,name?} → 201（抓取失败 502）
POST /admin/import-jobs/:id/parse         → 202（后台解析，租约串行）
GET  /admin/import-jobs?status&limit&offset → {total,limit,offset,rows}
GET  /admin/import-jobs/:id               → job + 按 review_status 计数
GET  /admin/import-jobs/:id/items?review_status&sensitive&limit&offset → {total,limit,offset,rows}
GET  /admin/import-jobs/:id/review.xlsx   → xlsx（列：序号/会话哈希/时间/问题/答案/脱敏/敏感/近似/建议/审核结果）
POST /admin/import-jobs/:id/approve-all   → 批量通过剩余条目
GET  /admin/import-jobs/:id/unpaired      / POST .../unpaired/pair → 未配对查看与人工补配
POST /admin/import-jobs/:id/confirm       body:{decisions:[{itemId,reviewStatus:"approved"|"rejected"}]} → {approved,written,dataset}
POST /admin/import-jobs/:id/rollback      → {ok:true}（删除数据集）
POST /admin/import-jobs/:id/retry         → 202
```

### 6.4 授权（M9）
```
GET  /admin/license        → LicenseState + currentUsage
POST /admin/license/reload → LicenseState（重跑 startupCheck）

LicenseState = { valid, reason, mock, fingerprint, expiresAtMs, daysLeft, maxChats }
currentUsage = { messagesReceived, assetsSent }
```

### 6.5 平台控制面（/platform/*，独立服务，仅 SaaS）

接口清单见概设 M11。鉴权链（自外向内）：

1. **HTTP Basic Auth**：`ADMIN_USER` / `ADMIN_PASSWORD`（SHA-256 常量比对）；未配置或错误 → 401。
2. **来源 IP 白名单**：`ALLOWED_ADMIN_IPS`（CIDR 列表，空则不限）；不在范围 → 403 `AUTH_FORBIDDEN`。
3. **reason 守卫**：所有非 GET 变更必须带 body `reason` 或 `X-Operator-Reason`，否则 400 `PLATFORM_REASON_REQUIRED`；`/platform/report` 豁免（Bearer `CONTROL_PLANE_TOKEN`）。
4. **双签与令牌**：destroy 需 `approvals` 去重后 ≥2 个审批人 + 导出时签发的一次性 `confirmToken`。

- **不提供 mTLS**；远程管理通过 `docker-compose.control-plane-expose.yml` 叠加并设置 `CONTROL_PLANE_BIND` 为管理网段地址（默认不发布主机端口）。
- 跳板/堡垒机由交付方运维侧提供，产品侧只记录 `POST /platform/tenants/:id/shell-access` 审计。

## 7. 定时任务总表（adapter 内 @nestjs/schedule）

| 任务 | Cron（容器 TZ=Asia/Shanghai） | 内容 |
|---|---|---|
| license 复核 | `0 3 * * *` | 验签+指纹+回拨复核，写 license.lic.antireplay.json，失效→受限模式 |
| miss 清理 | `30 3 * * *` | 删 90 天前记录 |
| 导入临时区清理 | `40 3 * * *` | 删 `data/import/*`、>30d review.xlsx、>180d import_item |
| 到期提醒 | `0 9 * * *` | 距 expires ≤15 天 → 运维群 webhook 告警 |
| 用量上报（SaaS） | `30 2 * * *` | POST /report（失败缓存 7 天） |
| 审计清理 | `50 3 * * *` | 导出 180 天前审计 JSONL 到 `PLATFORM_AUDIT_ARCHIVE_DIR`，成功后删除本地行 |
| 备份脚本 | 宿主 cron `0 2 * * *` | pg_dump + mongodump + assets（deploy/backup.sh） |

## 8. 构建、交付与反逆向管线

```
Dockerfile（多阶段 distroless 产物）：
  stage1 builder: pnpm install → nest build → javascript-obfuscator
        （controlFlowFlattening, stringArray+rc4, deadCodeInjection,
          selfDefending, idNames=hexadecimal）→ 剔除 *.map
  stage2 native: 拷入 license-native prebuilds/*.node（strip）
  stage3 runtime: gcr.io/distroless/nodejs20 + 非 root uid + HEALTHCHECK /healthz
镜像推送内网 registry → digest 记录 → 部署包附 SHA256SUMS.txt
```

- 本地档附加镜像：`local-models-compose.yml`（vllm + xinference）。
- 控制面与数据面共用同一镜像（`control-plane-main.ts` 独立入口，仅 SaaS 叠加启动）。

## 9. 测试设计

### 9.1 单元测试（覆盖率门禁：管道模块 ≥80%）

| 模块 | 重点用例 |
|---|---|
| wecom | 验签通过/篡改/时间戳偏移；AES 解密边界（随机串对齐）；验签失败告警（冷却期内一次）。被动回复 3.5s 竞速对群聊不适用（appchat 无被动回复），仅单聊场景保留 |
| routing | @解析（含昵称变体）；关键词命中/未命中；固定窗口边界（第 20/21 次） |
| context | TTL 续期、5 轮截断、Redis 故障 fail-open |
| orchestration | score 0.749/0.75 分界；素材引用 ≤2；长答案分段；双通道降级 |
| filter | 自动机命中/不命中/词库热切换原子性 |
| license | 验签失败/指纹不符/过期/回拨/缓存过期重验 |
| import | QA 配对（30min 断窗/多轮合并/单边池）；脱敏正则全表；幂等重试 |

### 9.2 集成测试

**默认（`TEST_PG_URL`）**：真实 PostgreSQL + 假外部依赖（InMemoryDatasetClient、假 docker/cert/授权），覆盖导入重管线、控制面开通/注销、租户配额等端到端流程；未设置 `TEST_PG_URL` 时整套 skip。

**可选真实栈冒烟**：`scripts/acceptance-real.sh`（`REAL_COMPOSE=1` 才执行，默认 skip）启动 nginx/adapter/fastgpt/pg/mongo/redis 六容器，做触发/静默/拒答/敏感词/素材/受限模式的真实链路验证。

### 9.3 压测验收（对应 PRD 指标）

- 50 并发回调持续 10min：P95 ≤8s、无消息丢失（对比发送与 miss/问答日志计数）；
- 洪峰：单群 100 条/分钟灌入 → 触发消息 100% 应答、非触发 100% 静默；
- 导入 1 万条消息文件：≤10 分钟完成解析+配对（吞吐 ≥2000 条/分）。

## 10. 开发任务映射（25 人天基线，供排期参考）

| 周 | 模块 | 人天 |
|---|---|---|
| W1 | M1+M2（接入/路由/去重/限流）+ M7 配置 | 6 |
| W2 | M3+M4（上下文/编排/FastGPT 对接/置信度）+ M6 | 7 |
| W3 | M5+M9（license Rust 模块+签发工具）+ 管理面 API | 5 |
| W4 | 部署/备份/监控 + 测试 + UAT 支持 + 文档 | 7 |

（增项 A=3、B=3、C=12、D=4 人天另计，按勾选并行插入 W2–W4。）

---

*版本记录：V1.0（2026-10-12）初版，依据概设 V1.8 编制；含工程结构、公共组件、M1–M11 详细设计、DDL、Redis 键、API 契约、定时任务、构建管线与测试设计。V1.1（2026-10-12）§6 补注管理面交付形态（本期纯 API，无自研前端；接口契约冻结，二期独立运营后台原样复用，不得破坏性变更），上游对齐概设 V1.9 与 PRD V1.5。V1.2（2026-10-29）按实现与主规格对齐：§6.2/§6.3 接口路径与入参、§5 Redis 键、§4 DDL 基线与关键词表、§3.10 容量字段。V1.3（2026-10-29）§3.10 编排渲染改为内联生成、§3.9 解析器改为四种格式；与概设 V1.11 同步。V1.4（2026-10-29）§2.1 改为出站客户端实际形态（axios + 公共 Semaphore），§6.1 补 JSON 导出结构与掩码口径。V1.5（2026-10-29）§2.1/§2.3 明确 `FastGPTClient` 为唯一 FastGPT 出口（问答/数据集/检索/计数），补 LLM 双通道失败告警。V1.6（2026-10-29）§9.1 改为固定窗口边界、标注 3.5s 群聊不适用；补验签失败告警。V1.7（2026-10-30）§1.4/§1.5/§1.6 按实现重写（五位错误码+字符串业务码、Ok/Err、chatHash/userHash、config-check 结构）；补私有化 FastGPT 后台入口（见部署手册 §7.7）。V1.8（2026-10-30）§2.4 按 `.d.ts` 重写 license-native 接口；§3.8 启动校验位置改为 `AppModule.onModuleInit`。V1.9（2026-10-30）§6.4 授权接口响应按 `LicenseState` + `currentUsage` 重写。V1.10（2026-10-30）§7 补审计清理 03:50；§2.1 补 `/healthz resources` 说明。V1.11（2026-10-30）§1.1/§1.2 按实际仓库与模块重写（同镜像双入口、qa/usage/health 等）；§9.2 拆分为集成测试与可选真实栈冒烟。V1.12（2026-10-30）§2.2 补 access_token 剩余 <300s 提前刷新。V1.13（2026-10-30）§3.2 限流改为按分钟固定窗口与 `rate:*` 键；§3.3 上下文写入表述；§3.2/§3.8 错误码改符号名；`license.lic.antireplay.json` 名称统一V1.14（2026-10-30）§4 删除重复 DDL，改为迁移文件索引（结构与字段以迁移与概设 §7.1/§7.4 为准）V1.15（2026-10-30）§6.5 平台鉴权按实际重写（Basic+IP+reason+双签/令牌，无 mTLS；跳板归属说明）。V1.16（2026-10-30）§3.9 R-8 改为 `ImportTaskQueue`/增量 200MB 或 80% 限额/每 5s 轮询。V1.17（2026-10-30）§2.3 空引用 score=0；§3.1 主动发送/错误码；§3.4 拒答文案/素材 UUID；§3.7 上传参数与 ASSET_*；§3.8 群数上限运行期；§3.9 脱敏来源；§3.10 09:00/expired_at；§8 同镜像双入口。*
