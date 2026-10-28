# 微信群智能客服机器人 MVP — 详细设计文档

| 项 | 内容 |
|---|---|
| 文档名称 | 详细设计说明书（内部工程文档，不对外交付） |
| 版本 | V1.1（V1.0 + 明确管理面交付形态：本期纯 API，契约视为冻结，二期运营后台原样复用） |
| 日期 | 2026-10-12 |
| 状态 | 待评审 |
| 适用读者 | 全栈工程师（直接据此编码） |
| 上游文档 | 《概要设计 V1.9》（模块 M1–M11、数据流 D1–D10、规则 R-1~R-8、ADR A1–A14）、《PRD V1.5》、《部署手册 V1.1》 |
| 设计基线 | NestJS 10 / Node 20 / TS 5.x；FastGPT v4.8.x；PG15+pgvector；Redis7；Mongo6；Rust(napi-rs) 授权核心 |

> 约定：本文所有接口/类型以 TypeScript 表达；`adapter` 指自研适配层服务；所有时间戳为 `timestamptz`；所有 ID 字符串不含敏感信息。与概设冲突时以概设为准并回报修订。

---

## 1. 工程组织与设计总则

### 1.1 代码仓库结构（monorepo，pnpm workspace）

```
cs-bot/
├── apps/
│   ├── adapter/               # 适配层（NestJS，消息管道 + 管理面）
│   └── control-plane/         # 平台控制面（NestJS，仅 SaaS 形态构建）
├── packages/
│   ├── shared/                # 两应用共享：类型、错误码、脱敏工具、Result
│   └── license-native/        # Rust napi-rs 源码与 .node 预编译产物
├── deploy/                    # compose 模板、nginx、config 出厂文件、backup.sh
└── tools/                     # 签发工具（license-issuer，仅交付方内部使用）
```

### 1.2 adapter 模块划分（与概设 M1–M11 一一对应）

```
apps/adapter/src/
├── main.ts                    # bootstrap：config 校验 fail-fast → license 启动强校验 → 任务注册
├── wecom/            (M1)     # WecomController(回调) + WecomCrypto + WecomClient
├── routing/          (M2)     # TriggerService（@/关键词/静默）+ RateLimiter + DedupService
├── context/          (M3)     # ContextService（Redis 上下文）
├── orchestration/    (M4)     # QaOrchestrator + FastGPTClient + ConfidenceJudge
├── miss/             (M5)     # MissService + MissExportService(xlsx)
├── filter/           (M6)     # SensitiveFilterService(DFA) + 词库热加载
├── config/           (M7)     # ConfigService(zod 校验) + HealthController
├── media/            (M8)     # MediaRecognizeService(qwen-vl) + AssetService + AssetSender
├── license/          (M9)     # LicenseService(调 license-native) + 受限模式 Guard
├── import/           (M10)    # ImportService + parsers/ + qa-pairing/ + ImportController
└── report/           (D10)    # UsageReportService（仅 SaaS 开关启用）
```

依赖方向强制单向（ESLint `nx/enforce-module-boundaries`）：`wecom → routing → license → context/media → orchestration → filter → wecom`；横切（miss/config）被引用不引用管道模块；**禁止反向 import**（R-1~R-8 的工程落地）。

### 1.3 分层约定

每个模块内：`Controller/entrypoint → Service（业务） → Client/Repository（外部 IO）`。Service 纯业务可单测；外部 IO（HTTP/Redis/PG/Rust）全部经 Client/Repository 接口注入，单测用内存 stub。

### 1.4 统一返回与错误码

```ts
// packages/shared
export type Result<T> = { ok: true; data: T } | { ok: false; code: ErrCode; msg: string };
export enum ErrCode {
  WECOM_SIGN_INVALID = 1001,      // 验签失败（回 401，不入管道）
  DEDUP_DUP = 1002,               // 重复消息（静默 success）
  RATE_LIMITED = 1003,            // 限流（静默或提示）
  NOT_TRIGGERED = 1004,           // 非触发（静默）
  LICENSE_RESTRICTED = 1005,      // 受限模式（回授权话术）
  FASTGPT_TIMEOUT = 2001, FASTGPT_5XX = 2002, LLM_TIMEOUT = 2003,
  LLM_ALL_FAILED = 2004,          // 双通道失败 → 繁忙话术
  CONF_LOW = 3001,                // 低置信拒答（正常业务，非错误）
  ASSET_MISSING = 4001, ASSET_SEND_FAIL = 4002,
  VL_TIMEOUT = 4003, VL_NO_TEXT = 4004,
  IMPORT_PARSE_FAIL = 5001, IMPORT_FILE_TOO_LARGE = 5002, IMPORT_STATE = 5003,
  CONFIG_MISSING = 9001, DB_FAIL = 9002, REDIS_FAIL = 9003,
}
```

错误处理三原则：① 可预期业务错误（1002/1003/1004/3001）记 INFO 级结构化日志，不打堆栈；② 外部 IO 错误按概设降级矩阵处理并 WARN；③ 未捕获异常由全局 ExceptionFilter 兜底回 `success`（防企微重推风暴）+ ERROR 日志 + 告警。

### 1.5 日志规范（结构化 JSON，pino）

- 字段：`ts, level, module, traceId, chatId, userId(哈希), msgType, errCode, costMs`；**正文仅 DEBUG 级**（生产关闭）。
- traceId = `msgid`（贯穿 D1–D9 全链路），日志中间件自动注入。
- 脱敏中间件：`maskPII(text)` 对手机号/身份证/银行卡/姓名模式替换为 `[PII:手机号]` 等，应用于任何即将落盘的正文字段。

### 1.6 配置规范（M7 落地）

- `.env` → `ConfigService`，启动时用 **zod schema** 全量校验：必填缺失/格式错误 → 打印缺失清单（值打码）→ `process.exit(1)`（fail-fast）。
- `GET /admin/config-check` 输出：`[{key, present, masked: "ww12***ef78"}]`。
- 运行期可变项（阈值/超时/话术）支持 `POST /admin/config/reload` 热加载（词库/关键词/导入规则同法）。

---

## 2. 公共组件详细设计

### 2.1 HttpClient（统一出站）

```ts
export interface HttpClient {
  request<T>(opts: {
    method: string; url: string; timeoutMs: number;
    retries?: number; backoffBaseMs?: number; // 指数退避，默认 1 次
    semaphore?: 'llm' | 'wecom' | 'vl';       // 信号量分组，上限可配
  }): Promise<Result<T>>;
}
```
- 信号量：`llm` 默认 4（本地档建议 2–4）、`wecom` 8、`vl` 2；队列 FIFO，超时=放弃排队。
- 重试仅对幂等请求（GET/企微主动发送带 client_msg_id 幂等）。

### 2.2 WecomClient（M1 出站，R-1 唯一企微出口）

| 方法 | 封装的企微 API | 说明 |
|---|---|---|
| `sendText(chatId, content, atUser?)` | appchat/send | 群文本 + @ 提问人（atuserlist） |
| `sendFile(chatId, mediaId)` | appchat/send(msgtype=file) | 素材文件消息 |
| `sendVideo(chatId, mediaId, title)` | appchat/send(msgtype=video) | 素材视频消息 |
| `uploadMedia(type, path)` | media/upload | 临时素材 3 天有效，失败重传 1 次 |
| `downloadMedia(mediaId)` | media/get | ≤10MB 图片下载到临时区 |
| `getAccessToken()` | gettoken | 内存缓存 7000s，失败刷新重试 |

access_token 刷新加分布式锁（Redis SETNX，双实例部署时防并发刷新）。

### 2.3 FastGPTClient（R-2 唯一 FastGPT 出口）

```ts
ask(req: { question: string; history: ChatTurn[]; datasetIds?: string[] }):
  Promise<Result<{ answer: string; quotes: Quote[]; score: number }>>
upsertQa(dataset: string, qa: QaPair[]): Promise<Result<{ ids: string[] }>>   // M10 入库
deleteDataset(dataset: string): Promise<Result<void>>                          // M10 回滚
```
- `ask`：POST `/api/v1/chat/completions`（FastGPT 应用 Key），解析 `responseData[].quoteList`；超时 15s（本地档 20–30s），重试 1 次（退避 1s）。
- 置信度：`score = max(quoteList[].score)`；无 quote → score=0。

### 2.4 license-native（Rust，M9 核心，R-1 例外说明）

```
packages/license-native/src/lib.rs
  pub fn verify(payload_json: String, sig_b64: String) -> Bool   // Ed25519 验签（公钥编译期内嵌）
  pub fn fingerprint() -> String                                 // 采集并哈希宿主指纹
  pub fn antireplay(last_ts: i64, now: i64) -> Bool              // 回拨判定
  pub fn selfcheck(js_ctx_hash: String) -> Bool                  // JS 入参防篡改自校验
```
- 产物 `index.linux-x64-gnu.node`，strip + 无调试符号；`verify` 内嵌固定公钥；检测 `--inspect`/ptrace 附加 → 返回 false 并落 `license.tamper` 标记（告警）。
- license.lic 文件格式：`base64(json payload) + "." + base64(Ed25519 signature)`（类 JWT 紧凑形式）。

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
   SHA1(sort(token, timestamp, nonce, Encrypt)) == msg_signature，否则 1001 → 401
4. 解析 XML → InboundMsg{ ToUserName, FromUserName(userid), ChatId(群), MsgType,
   Content?, MsgId?, MediaId?, PicUrl?, CreateTime }
5. 立即回 HTTP 200 空体（被动应答位留给答案，见 §3.1.2）
6. 投递管道（异步，不阻塞回调线程）：pipeline.process(msg)
```

**被动回复与主动补发（3.5s 竞速）**：`pipeline.process` 内部 `Promise.race([answerPromise, sleep(3500)])`；超时者回空被动包（`success`），答案就绪后 `WecomClient.sendText` 主动补发（带 `client_msg_id = traceId` 幂等）。

**去重（D2 前置）**：`SETNX dedup:{msgid} EX 172800`，返回 0 → 直接终止（1002）。

### 3.2 M2 路由触发（routing/）

**触发判定（顺序短路）**

```
isSelfOrBot(msg)            → 静默（机器人自身/其他应用消息）
msgType != text && !mentioned → 静默（未@多媒体，R 与 FR-9 一致）
mentioned = parseMention(Content)   // 企微 @ 列表含应用 userid/@昵称
keywordHit = KeywordService.match(text)  // keywords.yml 词表，Trie 前缀匹配
mentioned || keywordHit → 进入管道；否则静默(1004)
```

**限流（令牌桶，Redis Lua 原子）**

| 键 | 速率 | 超限行为 |
|---|---|---|
| `rl:group:{chatId}` | 20/min | 静默；同群每 5min 最多一次提示 |
| `rl:user:{chatId}:{userId}` | 5/min | 回"提问太频繁"话术 |

Lua 脚本 `tokenbucket.lua`：INCR + EXPIRE 原子化，避免竞态。

**关键词配置** `config/keywords.yml`：`keywords: [/客服, 请问：, 咨询：]`；`POST /admin/keywords/reload` → 重建内存 Trie（原子引用切换，读写锁）。

### 3.3 M3 会话上下文（context/）

- Redis 结构：`ctx:{chatId}:{userId}` = JSON 数组（近 5 轮 `[{"q","a"}...]`），TTL 600s，每轮写入后 `EXPIRE` 续期。
- 超过 5 轮：`LPUSH` 语义截断（数组 shift 最旧）。
- 读失败（REDIS_FAIL）→ fail-open 返回空历史（A5 决策），WARN。

### 3.4 M4 问答编排（orchestration/）

```
answer = await FastGPTClient.ask({ question, history: ctx.history })
score = answer.quotes.length ? max(quote.score) : 0
if (score < CONFIDENCE_THRESHOLD /*0.75*/) {
    miss.record({ question, chatId, userId, score, mediaType })
    replyText = REJECT_TEMPLATE      // "抱歉，这个问题我还没学会…@人工客服"
} else {
    replyText = compose(answer.answer, quotes)   // 答案 ≤2000 字分段 + 「来源：xx.pdf」
    assets = parseAssetRefs(replyText)            // /\[\[素材:(\d+)\]\]/g，≤2 个（FR-10）
    replyText = stripAssetRefs(replyText)
}
final = SensitiveFilter.sweep(replyText)          // 命中 → 整段替换 + 审计
ctx.append({q: question, a: final})
send(final)；随后按 assets 逐个 AssetSender.send()（增项 A，失败降级提示）
```

- 长答案分段：>2048 字节按句号边界切 ≤2000 字节多段，间隔 300ms 发送（防频控）。
- `LLM_TIMEOUT`/`LLM_ALL_FAILED`：繁忙话术 + 告警（企微群 webhook）。

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

**素材管理**：`POST /admin/assets`（multipart：类型/title/文件）→ 校验大小（file≤20MB/video≤10MB）与 md5 去重 → 存 `data/assets/{id}.{ext}`（0600）+ asset 表入库。
**素材外发**：`AssetSender.send(chatId, asset)`：link→sendText（title+URL）；file/video→uploadMedia→sendFile/sendVideo；失败→补发降级提示 + WARN（4001/4002）。

### 3.8 M9 授权许可（license/）

**启动强校验（main.ts，先于 HTTP listen）**

```
lic = read license/license.lic (0600)
payload, sig = split('.')
ok1 = native.verify(payload, sig)                    // 验签（公钥在 Rust 内）
ok2 = native.fingerprint() == payload.fingerprint    // 机器指纹
ok3 = now < payload.expires_at                       // 有效期
ok4 = native.antireplay(state.lastTs, now)           // 回拨（state 存 license.state JSON）
all ok → 缓存 {valid:true, until, maxChats} TTL 1h；否则 exit(1)（日志给原因码）
```

**运行期**：Guard 在管道 D3 位读缓存（<1ms）；每日 03:00 复核 + 写 `license.state {lastTs}`（0600）。失效→受限模式：`/healthz` unhealthy、回调只回授权话术（1005），FastGPT 后台不受限。
**群数上限**：接入配置加载时校验 `chats.length > maxChats` → 拒新群 + 告警（老群不动）。
**续期**：`POST /admin/license/reload` 重跑校验并刷新缓存。

### 3.9 M10 历史导入（import/，增项 B）

**任务状态机**：`uploaded → parsing → parsed → {approved | partial | rejected | rolled_back} | failed`（任一步失败可 `retry`，幂等按条目级 `source_hash`）。内部阶段（文件校验/配对/入库）通过 `total_msgs/parsed_msgs/masked/blocked/dedup/approved/imported/failed` 计数表达，不额外引入对外状态值（契约冻结）。

**解析器接口**

```ts
interface SessionParser {           // 三实现：ArchiveJsonParser / XlsxParser / CsvTxtParser
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

**脱敏（正则表，配置于 import-rules.yml）**

| 规则 | 正则（示例） | 替换 |
|---|---|---|
| 手机号 | `1[3-9]\d{9}` | `[手机号]` |
| 身份证 | `\d{17}[\dXx]` | `[身份证号]` |
| 银行卡 | `\d{16,19}`（Luhn 校验通过） | `[银行卡号]` |
| 地址 | `(省|市|区|路|号|栋|室)` 组合模式 | `[地址]` |
| 姓名 | 姓氏表 + 1-2 字（保守模式，宁漏勿错） | `[姓名]` |

**入库/回滚**：`confirm` → 通过条目按 50 条/批 `FastGPTClient.upsertQa('历史语料-{jobId}')`，失败退避重试 3 次；`rollback` → `deleteDataset`。

**资源保护（R-8）**：进程内 BullMQ-lite（单消费者）；批 2000 条间检查 `process.memoryUsage().rss > 0.8*limit` → 暂挂 5min；管理接口轮询进度。

### 3.10 M11 控制面（control-plane/，增项 C）

**Provisioner 状态机**：`alloc_slot → render_templates → init_db → issue_cert → sign_license → compose_up → healthcheck → register(active)`；任一步失败 → `rollback_steps`（已创建资源逆序删除）+ 状态 failed + 审计记录。

**模板渲染**：`env.hbs` + `compose.overrides.hbs`（端口段 = 30000+tenantIdx*10 起，db=tenant_{id}，网络=net_{id}）；证书：通配证书复用（SNI）或 per-tenant ACME。

**用量上报（D10）**：adapter 每日 02:30 `POST {CONTROL_PLANE_URL}/report`，body 仅计数：`{tenantId, date, msgsIn, triggered, hit, miss, tokens, activeChats}`；失败本地缓存 7 天后丢弃（不影响问答）。

**订阅状态机迁移**：每日 03:00 扫描 `sub_expire_at`：T-30/15/7 通知；到期→grace；grace+7d→suspended（向实例签发过期证书或置 license 失效）；续费→`renew`（签新证书 + 实例 reload）。

---

## 4. 数据库 DDL（PG15，schema=adapter）

```sql
CREATE SCHEMA IF NOT EXISTS adapter;

CREATE TABLE adapter.miss_record (
  id          BIGSERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  chatid      VARCHAR(64),
  userid      VARCHAR(64),
  score       NUMERIC(4,3),
  media_type  VARCHAR(16),
  status      SMALLINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_miss_status_created ON adapter.miss_record(status, created_at);

CREATE TABLE adapter.keyword_trigger (
  id       SERIAL PRIMARY KEY,
  keyword  VARCHAR(64) UNIQUE NOT NULL,
  enabled  BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE adapter.asset (
  id        SERIAL PRIMARY KEY,
  asset_type VARCHAR(16) NOT NULL CHECK (asset_type IN ('link','file','video')),
  title     VARCHAR(128) NOT NULL,
  url       TEXT,
  file_path VARCHAR(256),
  size      BIGINT,
  md5       VARCHAR(32),
  enabled   BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_type_enabled ON adapter.asset(asset_type, enabled);

CREATE TABLE adapter.import_job (
  id BIGSERIAL PRIMARY KEY,
  file_name VARCHAR(256) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  source_type VARCHAR(16) NOT NULL,
  total_msgs INTEGER DEFAULT 0, parsed_msgs INTEGER DEFAULT 0,
  paired_count INTEGER DEFAULT 0, unpaired_count INTEGER DEFAULT 0,
  masked_count INTEGER DEFAULT 0, blocked_count INTEGER DEFAULT 0,
  dedup_count INTEGER DEFAULT 0, approved_count INTEGER DEFAULT 0,
  imported_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0,
  dataset_name VARCHAR(64),
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  error TEXT,
  created_by VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_import_job_status ON adapter.import_job(status, created_at);

CREATE TABLE adapter.import_item (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES adapter.import_job(id) ON DELETE CASCADE,
  source_hash VARCHAR(64) UNIQUE NOT NULL,
  question TEXT,
  answer TEXT,                       -- rejected 条目为 NULL
  session_hash VARCHAR(32),
  occurred_at TIMESTAMPTZ,
  auto_blocked BOOLEAN NOT NULL DEFAULT false,
  similar_qa_id VARCHAR(64),
  review_status VARCHAR(12) NOT NULL DEFAULT 'pending',
  review_note VARCHAR(128),
  imported_qa_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_import_item_job ON adapter.import_item(job_id, review_status);

-- 平台侧（控制面独立 database，非 adapter schema）
CREATE TABLE tenant (
  id VARCHAR(16) PRIMARY KEY,
  name VARCHAR(64) NOT NULL, contact VARCHAR(64) NOT NULL,
  domain VARCHAR(128) UNIQUE NOT NULL,
  instance_host VARCHAR(64), port_base INTEGER,
  db_name VARCHAR(32), plan VARCHAR(16) NOT NULL DEFAULT 'standard',
  sub_status VARCHAR(12) NOT NULL DEFAULT 'trialing',
  sub_start_at TIMESTAMPTZ, sub_expire_at TIMESTAMPTZ,
  license_fp VARCHAR(64), image_version VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), destroyed_at TIMESTAMPTZ
);
CREATE TABLE tenant_quota (
  tenant_id VARCHAR(16) PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  max_chats INTEGER NOT NULL DEFAULT 10, max_msgs_per_day INTEGER NOT NULL DEFAULT 5000,
  max_docs INTEGER NOT NULL DEFAULT 200, max_qa INTEGER NOT NULL DEFAULT 5000,
  max_asset_mb INTEGER NOT NULL DEFAULT 2048, llm_token_monthly BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE tenant_usage_daily (
  tenant_id VARCHAR(16) NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  stat_date DATE NOT NULL,
  msgs_in INTEGER DEFAULT 0, msgs_triggered INTEGER DEFAULT 0,
  qa_hit INTEGER DEFAULT 0, qa_miss INTEGER DEFAULT 0,
  llm_tokens BIGINT DEFAULT 0, active_chats INTEGER DEFAULT 0,
  asset_mb NUMERIC(12,2), doc_count INTEGER, qa_count INTEGER,
  PRIMARY KEY (tenant_id, stat_date)
);
CREATE TABLE platform_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor VARCHAR(32) NOT NULL, tenant_id VARCHAR(16),
  action VARCHAR(32) NOT NULL, reason VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hash_prev VARCHAR(64)
);
```

## 5. Redis 键总表

| Key | 类型 | TTL | 用途 |
|---|---|---|---|
| `dedup:{msgid}` | string "1" | 172800s | 消息幂等（D2 前置） |
| `ctx:{chatId}:{userId}` | JSON array | 600s | 会话上下文（M3） |
| `rl:group:{chatId}` / `rl:user:{c}:{u}` | counter（Lua） | 60s | 限流（M2） |
| `license:cache` | JSON | 3600s | 授权校验缓存（M9） |
| `wecom:at` | string | 7000s | access_token 缓存 + 刷新锁 |
| `import:queue` | list | 持久 | 导入任务队列（M10） |
| `report:buffer` | list | 7d | 用量上报失败缓存（D10） |

## 6. API 契约（管理面，Basic Auth + IP 白名单）

> 交付形态：本期管理面**只有 API**（无自研前端），随《操作手册》附 curl / 表单调用示例；知识运营界面由 FastGPT 自带后台承担。下述接口契约在二期独立运营后台中**原样复用**（二期仅叠加前端与权限），因此本节的 URL/入参/出参视为冻结契约，二期不得破坏性变更。

### 6.1 未命中导出
`GET /admin/miss-records?from=2026-10-01&to=2026-10-11&format=xlsx` → `200 application/vnd.openxml…`（流式 xlsx）；`format=json` → `{total, items:[{question, chatId, score, mediaType, status, createdAt}]}`（脱敏）。

### 6.2 素材（增项 A）
```
POST /admin/assets            multipart: type,title,file|url → 201 {id}
GET  /admin/assets            → {items:[{id,type,title,size,enabled,url?}]}
DELETE /admin/assets/:id      → {ok:true}（enabled=false）
```

### 6.3 导入（增项 B）
```
POST /admin/import/jobs                   multipart file → 202 {jobId}
GET  /admin/import/jobs                   → {jobs:[{jobId,status,stats…}]}
GET  /admin/import/jobs/:id               → {jobId,status,stats:{parsed,paired,masked,blocked,dedup,approved,imported,failed}}
GET  /admin/import/jobs/:id/review.xlsx   → xlsx（列：序号/会话哈希/时间/问题/答案/脱敏/敏感/近似/建议/审核结果）
POST /admin/import/jobs/:id/confirm       body:{items:[{itemId,action:"keep"|"modify"|"reject",modified?}]} → {imported:n}
POST /admin/import/jobs/:id/rollback      → {ok:true}
POST /admin/import/jobs/:id/retry         → 202
```

### 6.4 授权（M9）
```
GET  /admin/license        → {valid, reason?, expiresAt, daysLeft, maxChats, fingerprint}
POST /admin/license/reload → {valid, expiresAt}
```

### 6.5 平台控制面（/platform/*，独立服务，仅 SaaS）
见概设 M11 接口表；鉴权 mTLS 或管理员 token + 双签机制（敏感操作如 destroy 需 body 含 `confirmToken` 一次性令牌）。

## 7. 定时任务总表（adapter 内 @nestjs/schedule）

| 任务 | Cron（容器 TZ=Asia/Shanghai） | 内容 |
|---|---|---|
| license 复核 | `0 3 * * *` | 验签+指纹+回拨复核，写 license.state，失效→受限模式 |
| miss 清理 | `30 3 * * *` | 删 90 天前记录 |
| 导入临时区清理 | `40 3 * * *` | 删 `data/import/*`、>30d review.xlsx、>180d import_item |
| 到期提醒 | `0 9 * * *` | 距 expires ≤15 天 → 运维群 webhook 告警 |
| 用量上报（SaaS） | `30 2 * * *` | POST /report（失败缓存 7 天） |
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
- 控制面镜像单独构建（SaaS 形态才交付）。

## 9. 测试设计

### 9.1 单元测试（覆盖率门禁：管道模块 ≥80%）

| 模块 | 重点用例 |
|---|---|
| wecom | 验签通过/篡改/时间戳偏移；AES 解密边界（随机串对齐）；3.5s 竞速分支 |
| routing | @解析（含昵称变体）；关键词命中/未命中；令牌桶边界（第 20/21 次） |
| context | TTL 续期、5 轮截断、Redis 故障 fail-open |
| orchestration | score 0.749/0.75 分界；素材引用 ≤2；长答案分段；双通道降级 |
| filter | DFA 命中/不命中/词库热切换原子性 |
| license | 验签失败/指纹不符/过期/回拨/缓存过期重验 |
| import | QA 配对（30min 断窗/多轮合并/单边池）；脱敏正则全表；幂等重试 |

### 9.2 集成测试（docker compose 起 6 容器）

企微回调模拟器（官方算法构造加密报文）→ 端到端断言：触发/静默/拒答/上下文/去重/限流/敏感词替换/素材外发/受限模式。

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

*版本记录：V1.0（2026-10-12）初版，依据概设 V1.8 编制；含工程结构、公共组件、M1–M11 详细设计、DDL、Redis 键、API 契约、定时任务、构建管线与测试设计。V1.1（2026-10-12）§6 补注管理面交付形态（本期纯 API，无自研前端；接口契约冻结，二期独立运营后台原样复用，不得破坏性变更），上游对齐概设 V1.9 与 PRD V1.5。*
