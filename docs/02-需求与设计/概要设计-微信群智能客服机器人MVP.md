# 微信群智能客服机器人 MVP 概要设计文档

## 1. 文档信息

| 项目 | 内容 |
|---|---|
| 文档名称 | 微信群智能客服机器人 MVP 概要设计说明书 |
| 版本 | V1.20（V1.19 + 租户按需恢复） |
| 日期 | 2026-10-12 |
| 状态 | 待评审 |
| 适用读者 | 全栈工程师（直接据此编码）、项目经理（**内部文档，不对外交付**——成品系统交付模式，客户仅接触部署包与操作手册） |
| 关联文档 | 《PRD V1.5》《详细设计 V1.11（docs/详细设计-微信群智能客服机器人MVP.md）》《部署手册 V1.13》《项目报价单（私有化基线 ¥27,500 / 25 人天；增项 A/B 各 +3 人天 ¥3,300；增项 C SaaS 平台建设 +12 人天 ¥13,200；增项 D 本地模型 +4 人天 ¥4,400）》 |

## 2. 设计目标与约束

### 2.1 设计目标
- 在企业微信客户群中提供智能问答：@机器人或命中关键词触发，非触发消息静默不响应。
- 命中知识库则返回答案并附来源；未命中/低置信则礼貌拒答并落库供学习补录。
- 端到端响应 **P95 ≤ 8s**（企微消息到达 → 机器人回复发出）；FAQ 命中率目标 ≥ 80%（以 PRD 验收口径"目标值、以实测为准"为准）。
- **双交付形态**：同一代码基同时支持 ① 私有化单实例部署（客户服务器）与 ② SaaS 托管（每租户一实例，控制面统一编排）；功能集一致，差异仅在部署位置、运维责任与授权付费方式（PRD FR-8/FR-12）。

### 2.2 硬约束
| 约束 | 说明 | 设计影响 |
|---|---|---|
| 资源约束 | 客户云服务器 4C8G / 100G SSD / 5M 带宽，单机部署 | 全量服务 Docker Compose 单机编排；内存预算总量 ≤ 6.5G；不引入重型组件（Elasticsearch/Kafka 等一律不选） |
| 人力约束 | 1 名全栈、25 人天 | 最大化复用 FastGPT 自带能力（知识库管理/切分/向量检索/工作流均不自研）；自研仅"企微接入适配层"薄层 |
| FastGPT 复用约束 | 问答编排、文档管理、补录学习均在 FastGPT 后台完成 | 不自建知识库后台；M5 仅做未命中记录与导出，补录动作为人工在 FastGPT 完成 |
| 合规约束 | 日志不落明文 PII；密钥不入库不入代码仓 | .env + 文件权限基线；日志脱敏中间件 |
| 多形态约束（V1.6） | 同一代码基支撑两种交付形态，不维护两条分支 | 部署差异全部下沉到配置层（compose 模板 + env 变量）；租户化能力以"单实例多部署"实现，不做代码级多租户改造 |

## 3. 总体架构

### 3.1 逻辑架构与数据流（V1.7 重绘）

图中 `D1–D10` 为端到端数据流编号，含义见本节末数据流清单：

```
              ┌─────────────── 企业微信侧（客户群） ───────────────┐
              │ D1 群消息回调(HTTPS POST, msg_signature+AES)      │
              │ D9 机器人回复 ← 被动回复(≤5s)/主动消息API(异步补发)│
              └──────────────┬─────────────────────▲─────────────┘
                             │ D1                  │ D9
┌─────────── Nginx 容器（TLS 终结, 宿主 443 反代） ──┼─────────────┐
│                            ▼                     │             │
│  ┌────── 适配层 adapter 容器（Node 20 / NestJS）─┴───────────┐ │
│  │ ◆ 消息处理管道（入口→出口单向，详见 §3.2 管道图）        │ │
│  │   M1 接入 → M2 触发 → M9*授权闸门 → M3 上下文 → M4 编排  │ │
│  │   → M6 出站过滤 → M1 发送   （M9* 校验缓存 1h）          │ │
│  │ ◆ 横切模块                                              │ │
│  │   M5 未命中落库 · M7 配置密钥 · M8 多媒体素材(增A)       │ │
│  │   M10 历史导入(增B) · M9 授权与反逆向                    │ │
│  │ ◆ 管理面（/admin/*，Basic Auth + IP 白名单）             │ │
│  │   导出 / 素材 / 导入任务 / license 查询续期 / 配置自检    │ │
│  └───┬──────────────┬─────────────────┬─────────────────────┘ │
│      │ D6 HTTP      │ Redis           │ SQL                    │
│      ▼              ▼                 ▼                        │
│  ┌────────────┐ ┌──────────┐ ┌───────────────┐ ┌──────────┐  │
│  │  FastGPT   │ │  Redis   │ │  PostgreSQL   │ │  MongoDB │  │
│  │  问答中枢  │ │ 上下文/  │ │ pgvector+业务 │ │ FastGPT  │  │
│  │            │ │ 去重     │ │ 表(schema=    │ │ 元数据   │  │
│  │            │ │          │ │ adapter)      │ │          │  │
│  └─────┬──────┘ └──────────┘ └───────────────┘ └──────────┘  │
└────────┼───────────────────────────────────────────────────────┘
         │ D6 出站 HTTPS
         ▼
  外部 AI：DeepSeek(主)/通义(备)；D8 视觉：通义 qwen-vl（增A）
  （SaaS 形态附加 D10：用量计数上报控制面，仅计数无正文）
```

**数据流清单**

| 编号 | 流向 | 内容 | 协议/约束 |
|---|---|---|---|
| D1 | 企微云 → Nginx → M1 | 群消息回调 | HTTPS，msg_signature 验签 + AES 解密，失败 401 |
| D2 | M1 → M2 | 解析后的消息对象（msgId/from/chatId/type/正文） | 进程内调用 |
| D3 | M2 → M9 → M3 | 过触发判定的消息先过授权闸门（缓存校验，失效→受限模式）再装配上下文 | 进程内，<1ms |
| D4 | M3 → M4 | 问题 + 近 5 轮上下文（群+人隔离，TTL 10min） | 进程内 |
| D5 | M4 → M6 | 答案 + 来源引用 + 素材引用标记；拒答/低置信改走 M5 落库 | 进程内 |
| D6 | M4/M10 ↔ FastGPT | 问答检索与生成 / 历史语料写入；FastGPT 再出站调 LLM | 内网 HTTP；LLM 出站 HTTPS，硬超时 15s |
| D7 | M6 → M1 | 过滤后最终文本（命中敏感词→替换话术 + 审计日志） | 进程内 |
| D8 | M8 ↔ 企微/通义 | 素材下载与外发（企微 API）；图片识别 qwen-vl（超时 10s） | HTTPS |
| D9 | M1 → 企微云 | 被动回复（3.5s 内就绪）或主动消息补发 | HTTPS |
| D10 | adapter → 平台控制面 | 用量计数日报（仅 SaaS 形态，失败缓存 7 天后丢弃） | HTTPS，不含正文 |


### 3.2 各层职责
| 层 | 职责 | 边界说明 |
|---|---|---|
| 企微侧 | 消息上行回调、下行收发通道 | 仅通过官方 API 交互，不触碰任何非官方协议 |
| Nginx | TLS 终结、反向代理、请求体大小限制、基础访问日志 | 不做业务逻辑 |
| 适配层（自研薄层） | 企微协议适配、触发路由、上下文、置信度编排、未命中落库、出站过滤、历史语料导入（V1.5） | 唯一自研服务；不含知识库/向量/切分逻辑 |
| FastGPT 层 | 知识库管理、文档切分、bge embedding、pgvector 检索、工作流编排、人工补录后台 | 开箱即用，仅做配置与 API 对接 |
| 数据层 | Redis（上下文/去重，允许丢）、PostgreSQL（未命中等持久表）、MongoDB（FastGPT 内部） | 适配层只读写 Redis 与 PG；Mongo 由 FastGPT 独占 |
| 外部 LLM | DeepSeek 主推理，通义 fallback | 由 FastGPT 模型配置管理，双通道可切换 |
| 平台控制面（仅 SaaS 形态，V1.6） | 租户开通编排、配额计量、订阅管控、升级编排与监控聚合 | 独立部署、独立数据库；**不存租户知识库正文、不参与消息链路**（实例自治，控制面故障不影响租户问答） |

### 3.3 交付形态与部署拓扑（V1.6）

同一代码基、同一镜像矩阵，两种形态：

**形态 A：私有化部署（基线）**
```
客户云服务器 4C8G（单租户单实例）
┌──────────────────────────────────────────────┐
│ Nginx(443) → 适配层 → FastGPT/PG/Redis/Mongo │
│ license.lic 绑定本机指纹，有效期与质保对齐      │
└──────────────────────────────────────────────┘
运维：客户方；升级：客户侧维护窗口；授权：机器指纹绑定
```

**形态 B：SaaS 托管（增项包 C）**
```
我方云（平台控制面 + 租户实例池）
┌────────────── 控制面（1 套，共享） ────────────────────┐
│ 租户注册表 / 开通编排 / 配额计量 / 订阅管控 / 升级编排   │
│ / 监控聚合 / 运维审计  ← 不存租户知识库正文             │
└───────┬───────────────┬───────────────┬───────────────┘
        │               │               │
┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼────────┐
│ 租户实例 T-01│ │ 租户实例 T-02│ │ 租户实例 T-0N│   ← 每租户独立一套
│ nginx+adapter│ │ nginx+adapter│ │ ...          │     容器组/数据库/
│ FastGPT/PG/  │ │ FastGPT/PG/  │ │              │     域名/密钥/证书
│ Redis/Mongo  │ │ Redis/Mongo  │ │              │     网络互不可达
│ license:订阅 │ │ license:订阅 │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
运维：我方；升级：平台统一滚动；授权：订阅期签发、到期受限
```

| 维度 | 形态 A 私有化 | 形态 B SaaS 托管 |
|---|---|---|
| 部署位置 | 客户服务器 | 我方云（每租户独立实例） |
| 数据归属/隔离 | 数据不出客户域 | 租户数据归租户，实例级物理隔离，不跨租户 |
| 运维责任 | 客户方（我方提供手册与指导） | 我方（含监控、备份、升级、故障处理） |
| 授权与付费 | 一次性交付 + 年度维护；证书绑定机器指纹 | 订阅制（月/年）；证书绑定租户实例、有效期=订阅期 |
| 资源规格 | 4C8G 起（客户自备） | 标准档 4C8G 独享实例（我方提供） |
| 升级方式 | 客户在维护窗口执行升级包 | 平台滚动升级，租户无感，支持回滚 |
| 开通时效 | 客户资源就绪后 2 小时内 | ≤ 30 分钟（控制面编排） |
| 适配客户 | 数据敏感、已有服务器/运维能力 | 中小客户、不想运维、快速上线 |

- 两形态共用同一套镜像与配置模板；形态差异仅体现在：compose 编排模板、域名/证书来源、授权证书类型（永久绑定指纹 / 订阅期）、监控上报开关（SaaS 上报控制面）。
- 形态迁移（V1.6 设计要点）：知识库/素材/未命中记录/配置均以可导出格式落盘（文档原件 + `assets` + `pg_dump` + config 目录），迁移=导出 + 在新形态导入，无需改造数据模型。

### 3.4 核心处理链路与模块依赖规则（V1.7 新增）

**消息处理管道（入口 → 出口，单向流动）**

```
企微回调（D1）
   │
   ▼
[M1 验签/解密/解析] ──验签失败──▶ 401，不处理
   │ 文本消息
   ▼
[M2 触发判定] ──未触发──▶ 静默（未 @ 的多媒体同样静默）
   │ @机器人 / 命中关键词；同时做限流与 msgid 去重
   ▼
[M9 授权闸门] ──失效/过期──▶ 受限模式话术（不进问答，零 LLM 消耗）
   │ 有效（校验结果缓存 1h，每日 03:00 复核）
   ▼
[M8 多媒体分流]（增项 A）
   ├─ @+图片 ──▶ qwen-vl 识别转文字 ──▶ 回到下方"问题"入口
   ├─ @+语音/视频/文件 ──▶ 引导话术 + miss_record(media_type) ──▶ [M6] 发送
   └─ 纯文本 ──────────────────────────┐
                                      ▼
[M3 上下文装配]（近 5 轮，群+人隔离，TTL 10min）
   │
   ▼
[M4 问答编排] ──调 FastGPT（检索+生成，LLM 硬超时 15s）──▶ 答案+来源引用+[[素材:id]]
   ├─ 置信度 < 0.75 ──▶ 拒答话术 + [M5 未命中落库]（含 media_type）
   └─ 命中 ──▶ [M6 出站敏感词过滤]（Aho-Corasick，命中→整段替换+审计）
                │
                ▼
        [M1 发送]：3.5s 内走被动回复；超时转主动消息 API 补发（D9）
        （增项 A：随后逐个外发素材——链接=文本消息、文件/视频=企微消息，失败降级提示）
```

**管理链路（异步，不占消息管道）**：`/admin/*`（Basic Auth + IP 白名单）→ 未命中导出（M5）/ 素材管理（M8）/ 历史导入任务（M10，单任务并发，内存 >80% 自动暂挂）/ license 查询与续期热加载（M9）/ 配置自检（M7）。**交付形态：本期为纯 API + 操作手册内调用示例，不提供自研管理界面（知识运营仍用 FastGPT 自带后台）；管理接口的可视化统一归二期独立运营后台（见 PRD 3.2、报价单第五节），接口契约保持不变，二期仅为前端叠加。**

**模块依赖规则（编码必须遵守的边界）**

| 规则 | 内容 | 目的 |
|---|---|---|
| R-1 单一企微出口 | 只有 M1 可调用企微 API（收发/素材下载上传）；M8 外发素材也经 M1 的 WecomClient | 协议变更影响面收敛到单模块 |
| R-2 单一 FastGPT 客户端 | M4 与 M10 经同一个 FastGPTClient 封装调用（问答 API / 数据集 API） | 统一超时、重试与鉴权 |
| R-3 出站必经过滤 | 含**动态内容**的发往群内文本必须过 M6；系统内置固定话术（授权/租户闸门、多媒体引导）与管理员配置的素材标题除外——前者不含用户输入，后者非群消息来源；文件/视频二进制不过滤（治理责任归客户） | 内容安全兜底且不增加无收益链路 |
| R-4 授权前置 | M9 在管道入口作闸门且校验结果缓存（单消息开销 <1ms）；受限模式下不触达 M3–M6 | 权益保护不影响性能 |
| R-5 配置统一入口 | 所有模块经 M7 ConfigService 读配置；密钥仅 .env 注入 | 密钥不散落 |
| R-6 文件落盘分区 | 素材仅 `data/assets/`（纳入备份）；导入临时文件仅 `data/import/`（即用即删）；license 仅 `license/` | 备份与清理策略可按目录执行 |
| R-7 不越层数据访问 | 适配层只读写 Redis 与 PG（schema=adapter）；不直连 pgvector / Mongo（归 FastGPT） | 保持薄层边界，避免与 FastGPT 内部结构耦合 |
| R-8 导入不抢管道 | M10 任务单并发、分批解析、内存水位超 80% 自动暂挂；实时问答永远优先 | 4C8G 下保护问答 SLA |

### 3.5 关键架构决策记录（ADR 摘要，V1.7 新增）

| # | 决策 | 理由 | 被否备选与原因 |
|---|---|---|---|
| A1 | 问答中枢选 FastGPT 开源版（锁定 v4.8.x） | 知识库后台/切分/向量检索/工作流/补录开箱即用，25 人天内可交付 | LangChain 自研：全链路自建工作量 ≥3 倍；Dify：应用编排强但知识运营后台弱于 FastGPT |
| A2 | 适配层为 NestJS **单体薄层**，模块以代码边界（module）划分 | 单全栈交付、单容器部署、无分布式开销；模块边界以 R-1~R-8 规则约束 | 微服务拆分：4C8G 单机下纯增复杂度 |
| A3 | LLM 走云 API（DeepSeek 主/通义备） | 免 GPU 成本、开通即用；FastGPT 模型配置可整体切换 | 本地部署模型：A10 GPU ¥3-4k/月，超 MVP 预算，留二期 |
| A4 | 置信度阈值 0.75 + 低置信拒答转人工 | 宁可拒答不可编造；拒答同时进 M5 学习闭环 | 纯生成不判置信：幻觉风险不可控 |
| A5 | Redis 故障 fail-open（无上下文单轮 + 内存去重） | 上下文丢失只影响体验不影响正确性；可用性优先 | fail-closed：Redis 抖动即全量拒答，体验劣化 |
| A6 | 单机 Docker Compose（容器 restart 策略 + 宿主 docker 自启） | 4C8G 单机、无 K8s 运维成本；25 人天约束 | K8s/Swarm：单租户规模下收益为负 |
| A7 | SaaS = 每租户独立实例（单实例多部署） | 物理隔离、合规表述强、代码零改造、无噪声邻居；资源成本用订阅价覆盖 | 共享实例+逻辑隔离（行级租户字段）：代码大改、隔离弱、噪声邻居 |
| A8 | 授权为 Ed25519 **离线证书** + 机器指纹（M9） | 客户环境可能无对授权服务器的出站通道；离线可交付、续期热加载 | 在线授权服务器：引入新的可用性依赖与网络开通协调成本 |
| A9 | 反逆向 = 全量混淆 + 核心逻辑 Rust 原生模块 | 性价比平衡：防通用工具反推，验签逻辑不入 JS 产物 | VMP/加壳/加密狗：成本与交付复杂度不成比例，另行评估 |
| A10 | 多媒体/素材/历史导入/SaaS 以增项包解耦 | 基线控预算（客户 <3 万），能力可勾选；避免基线膨胀 | 全部并入基线：报价超客户预算，丢单风险 |
| A11 | 历史导入强制人工审核门禁 + 敏感黑名单 | 历史人工回复含超权限承诺，直接学习会把风险带进自动回复 | 全自动学习：合规风险最高，PRD 明确排除 |
| A12 | M11 控制面不存租户正文、不参与消息链路 | 平台不成为数据集中风险点；控制面故障不影响租户 | 控制面集中存租户数据：安全与信任成本高 |
| A13 | 本地模型经 **OpenAI 兼容端点**接入 FastGPT，不自研推理层（V1.8） | vLLM/Ollama 原生暴露 /v1，FastGPT 原生支持自定义渠道→零代码三档切换；推理引擎升级与业务解耦 | 自研推理层/适配层内嵌模型：多维护一条技术栈，无对应收益 |
| A14 | embedding 与 LLM 通道解耦：LLM 可热切，embedding 切换必须全量重建索引（V1.8） | 向量空间不兼容是物理约束；将重建定为一次性迁移操作（0.5–2h）并写入操作手册，避免运行期误切 | 试图做双向量空间兼容：复杂度不成比例 |

## 4. 技术选型清单

所有选型统一按六个维度评估，下表末列为"性能/并发/可维护性"三要点（成本/合规/工期见 §4.2 对比矩阵）：**性能**（时延/吞吐达标）、**并发**（异步与连接模型能否支撑洪峰）、**可维护性**（配置化/升级/排障/社区成熟度）。

| 类别 | 选型 | 版本基线 | 级别 | 性能 / 并发 / 可维护性要点 |
|---|---|---|---|---|
| 适配层语言/框架 | Node.js + NestJS + TypeScript | Node 20 LTS / NestJS 10 | 推荐 | 性能：纯 IO 路径单容器可承 ≥50 回调 QPS；并发：事件循环异步 IO 契合回调密集型、无线程切换开销；可维护：TS 类型 + Nest 模块边界（对应 §3.4 R-1~R-8），生态与人才易得 |
| 企微加解密 | WXBizMsgCrypt 官方算法移植 | — | 强制 | 性能：单次验签+AES 解密 <1ms；合规：官方算法红线，禁止自造 |
| 问答平台 | FastGPT 开源版 | 锁定 v4.8.x（部署时固定 tag） | 强制 | 性能：pgvector 检索 + 工作流编排，千级 QA 检索 P95 <500ms；并发：支持多副本横向扩；可维护：知识库后台/切分/补录开箱即用，版本锁 tag、升级须回归 |
| 向量库 | pgvector（随 FastGPT 的 PG 实例） | pg 15 + pgvector 0.7 | 强制 | 性能：HNSW 索引，5 万级向量 top-k 毫秒级；可维护：与业务库同实例少一个组件；扩容：超量时拆专用实例/读副本 |
| 元数据 | MongoDB | 6.x（FastGPT 独占） | 强制 | FastGPT 硬依赖；适配层不直接读写，无性能关切 |
| 缓存/去重/上下文 | Redis | 7.x | 推荐 | 性能：单机 10 万+ QPS，远超需求；可维护：数据可丢（fail-open），运维零负担 |
| 业务持久库 | PostgreSQL | 15（与 FastGPT 的 PG 共用实例、独立 schema=adapter） | 推荐 | 性能：业务表写入 <10ms；可维护：与向量库同实例、备份统一 pg_dump |
| 模型通道（V1.8 重定义） | 三档可配：①云 API（DeepSeek 主/通义备，基线）②本地推理（vLLM/Ollama + Qwen2.5-7B/14B）③混合（本地优先+云兜底） | 经 FastGPT OpenAI 兼容渠道配置 | 强制（接入能力含在基线，本地部署为增项 D） | 性能：云 API 全文 3–6s；本地 7B GPU 40–60 tok/s、vLLM 连续 batching A10 并发 ~10 路；并发：出站信号量 + 超时切换；可维护：**三档切换=改配置零代码**，详见 §4.3 |
| 本地推理引擎（增项 D） | vLLM（GPU）/ Ollama（CPU 轻量） | vLLM 0.6+ / Ollama 0.5+ | 推荐（V1.8） | 性能：vLLM PagedAttention+continuous batching，吞吐为直跑 3–5 倍；可维护：暴露 /v1 OpenAI 兼容 API，FastGPT 直接配渠道，运维仅一个容器 |
| 本地 Embedding（增项 D） | Xinference / TEI + bge-m3 | bge-m3 | 推荐（V1.8） | 性能：CPU 2C2G 批 50 条 ~200ms；可维护：FastGPT 原生支持 Xinference 渠道；**注意切换 embedding 需全量重建向量索引**（§4.3） |
| 敏感词过滤 | 本地 Aho-Corasick 自动机（自研）+ 词库文件 | — | 强制 | 性能：万级词库单次匹配 <1ms；可维护：txt 词库热加载免重启 |
| 授权核心原生模块 | Rust + napi-rs（M9） | Rust 1.7x / napi-rs 2.x | 强制（V1.4） | 性能：闸门校验 <1ms（缓存 1h）；可维护：随主构建管线交叉编译 |
| 会话文件解析 | exceljs 流式 + 自研 CSV/JSON 流式解析 | — | 推荐（V1.5） | 性能：≥2000 条/分钟；可维护：分批断点、失败可重试、峰值内存 <200MB |
| 平台控制面 | NestJS + 租户注册表 + compose 模板编排 | 复用 Node 20 | 推荐（V1.6） | 可维护：同技术栈同构建管线；Provisioner 接口抽象，>20 租户可换 Swarm/K8s 后端而不改接口 |
| 租户反向代理 | Nginx（通配域名 + SNI） | 1.25-alpine | 推荐（V1.6） | 性能：单核万级 RPS；可维护：证书集中管理 |
| 部署 | Docker Compose（`restart: unless-stopped`） | compose v2 | 强制 | 可维护：一键拉起、容器自愈、升级/回滚路径明确（部署手册 §9.3）；规模上限与扩展见 §11.4 |
| 监控 | 云厂商免费监控 + 健康检查 + 企微群告警 | — | 推荐 | 可维护：零成本满足最低可观测；二期可接 Prometheus |
| 不引入 | Kafka / ES / K8s / 自研 embedding 服务 / 自研推理层 | — | — | 超资源与工作量约束，明确排除（评估对比见 §4.2） |

### 4.2 关键选型对比矩阵（含被否备选，V1.8 新增）

评分 ●=强 / ◐=中 / ○=弱（针对本项目的规模与约束）：

| 决策点 | 候选 | 性能 | 高并发 | 可维护 | 成本 | 合规 | 工期 | 结论 |
|---|---|---|---|---|---|---|---|---|
| 问答中枢 | **FastGPT** | ◐ | ◐ | ● | ● | ● | ● | ✔ 选定 |
| | Dify | ◐ | ◐ | ● | ● | ● | ◐ | 应用编排强但知识运营后台弱，补录闭环成本高 |
| | LangChain 自研 | ●（可极限调优） | ◐ | ○ | ○ | ● | ○ | 全链路自建 ≥3 倍工期，25 人天不可行 |
| 适配层框架 | **NestJS（Node）** | ◐ | ●（异步 IO） | ● | ● | ● | ● | ✔ 选定 |
| | Go（Gin） | ● | ● | ◐ | ● | ● | ◐ | 性能余量在本项目无意义，企微加解密生态弱于 Node |
| | Java（Spring） | ◐ | ● | ● | ◐ | ● | ○ | 内存占用与工期不匹配 4C8G/25 人天 |
| LLM 通道 | **云 API（基线）** | ● | ●（弹性） | ● | ●（按量） | ◐ | ● | ✔ 基线（数据出域到模型服务商） |
| | **本地 vLLM + Qwen**（增项 D） | ◐ | ◐（A10 ~10 路） | ◐ | ◐（GPU 固定成本） | ●（不出域） | ◐ | ✔ 可选档：数据敏感客户 |
| | 本地 CPU int4 | ○（5–10 tok/s） | ○ | ◐ | ● | ● | ◐ | 仅极低量兜底，不推荐主通道 |
| 编排 | **Docker Compose** | — | — | ● | ● | — | ● | ✔ 单机 ≤20 租户/单客户 |
| | K8s | — | ● | ◐ | ○ | — | ○ | 单机场景收益为负，留 >20 租户再引入 |
| 消息中间件 | **不引入（Redis 承担）** | ● | ◐ | ● | ● | — | ● | ✔ 去重/上下文 Redis 即可，无异步解耦刚需 |
| | Kafka | ● | ● | ◐ | ○ | — | ○ | 单机场景纯增运维面 |

### 4.3 本地模型嵌入设计（V1.8 新增，增项包 D）

**目标**：模型能力可整体内嵌到系统内部（数据不出域），与云 API 并存、三档可切、**切换零代码**。

**接入方式（关键设计：不自研推理层）**
- vLLM/Ollama 均暴露 OpenAI 兼容端点（`/v1/chat/completions`）；FastGPT 原生支持自定义 OpenAI 兼容渠道 → 在 FastGPT 后台新增渠道 `http://vllm:8000/v1` + 模型名 `Qwen2.5-7B-Instruct` 即完成接入。
- 适配层零改动；仅按本地吞吐调整 `LLM_TIMEOUT_MS`（本地建议 20000–30000）与出站并发信号量（本地建议 2–4 路）。
- Embedding 同理：Xinference 承载 bge-m3，FastGPT 配 embedding 渠道指向本地端点。
- 视觉模型（增项 A 的 qwen-vl）本地化：Qwen2-VL-7B 经 vLLM 部署，M8 的视觉端点改配置即可切换（增项 D 之内可选）。

**三档路由策略（配置项 `MODEL_MODE`）**

| 档位 | 行为 | 适用 |
|---|---|---|
| cloud（基线） | DeepSeek 主 + 通义备，现状不变 | 对时延敏感、预算紧 |
| hybrid | 本地优先；本地超时（>20s）或不可用自动切云兜底 | 平衡：常规问题走本地，复杂/洪峰溢出走云 |
| local | 全本地；本地不可用时回繁忙话术（不出域） | 数据强敏感客户（金融/政务类） |

**资源与模型规格对照（供选型，GPU 由客户自备或 SaaS GPU 档）**

| 模型 | 部署方式 | 显存/内存 | 吞吐参考 | 并发参考 |
|---|---|---|---|---|
| Qwen2.5-7B-Instruct | vLLM, fp16 | GPU 16G（T4 可跑 int4 8G） | 40–60 tok/s | A10 ~10 路（连续 batching） |
| Qwen2.5-14B-Instruct | vLLM, int4 | GPU 12–16G | 25–40 tok/s | A10 ~6 路 |
| Qwen2.5-7B | Ollama, int4 | 纯 CPU 8C32G | 5–10 tok/s | 1–2 路（仅兜底） |
| bge-m3（embedding） | Xinference | CPU 2C2G | 批 50 条 ~200ms | 足够 |
| Qwen2-VL-7B（可选） | vLLM | GPU 16G | 图片 ~2–4s/张 | ~4 路 |

**本地档性能预期（写入验收口径，实测为准）**：7B GPU 档文本问答 P95 目标 ≤15s（预填 ~2s + 生成 500tok ~9s + 链路 3s）；低于云档 8s 是预期内的取舍，数据不出域优先时接受。

**降级与一致性**
- hybrid 模式：本地引擎健康检查（/healthz，30s 间隔）+ 单请求超时判定 → 自动回落云渠道；恢复后切回（滞回 5 分钟防抖动）。
- local 模式：本地不可用 → 繁忙话术 + 告警，**不外发任何数据**。
- **Embedding 切换红线**：云/本地 embedding 向量空间不兼容，切换 embedding 渠道必须**全量重建向量索引**（FastGPT 重新向量化任务，5 千 QA 约需 0.5–2 小时）；LLM 通道切换无此约束，可热切。
- 资源叠加：本地档实例总预算 = 基线 6.5G + vLLM 容器（GPU 显存独立）+ Xinference 2G；CPU 4 核留给推理（adapter 限 1 核不变）。


## 5. 核心模块设计

### M1 企微接入模块
- **职责**：回调验签（msg_signature+timestamp+nonce+Token 的 SHA1）、AES-CBC 消息加解密、XML/JSON 消息解析、被动回复（5s 窗口）与主动发消息（client 凭证缓存 access_token，提前 5 分钟刷新）。
- **关键流程**：POST /wecom/callback → 验签失败直接 401（不响应业务）→ 解密 → 产出标准化 InboundMessage → 交 M2；回复优先走被动回包，超时则降级主动发消息 API。
- **接口定义**：
  - `POST /wecom/callback?msg_signature=&timestamp=&nonce=` → 企微回调入口。
  - 内部：`WecomCrypto.verify()/decrypt()/encrypt()`；`WecomClient.sendText(chatid, content)`；增项扩展：`downloadMedia(mediaId): Buffer`（企微素材下载，3 天有效）、`uploadMedia(type, buffer): mediaId` 与 `sendFile(chatid, mediaId, title)` / `sendVideo(chatid, mediaId, title, desc)`（M8 素材外发使用）。

### M2 消息路由与触发模块
- **职责**：触发判定（@机器人 或 命中关键词表）、非触发静默（直接返回 success，无后续）、限流、去重幂等。
- **关键流程**：去重（Redis `SETNX dedup:{msgid} TTL 48h`，已存在则丢弃）→ 触发判定 → 限流（每群 20 条/分钟、每人 5 条/分钟，Redis 按分钟固定窗口（INCR+EXPIRE）；超限静默或回"提问太频繁，请稍后再试"每 5 分钟仅提示一次）→ 交 M3/M4。
- **接口定义**：`Router.dispatch(InboundMessage): RouteResult{triggered, reason}`。
- **出厂默认触发配置**（config/keywords.yml 样例，UAT 前由客户确认最终清单，写入客户配合事项）：
```yaml
triggers:
  at_robot: true            # @机器人 必配
  prefixes: ["客服：", "客服,", "请问：", "咨询："]   # 前缀词触发
```
- 关键词热加载：`POST /admin/keywords/reload`。

### M3 会话上下文模块
- **职责**：维护近 5 轮问答上下文，群+人双维度隔离，超时重置。
- **数据结构（Redis）**：
  - Key：`ctx:{chatid}:{userid}`（隔离键 = 群 ID + 发言人 ID）
  - Value：JSON 数组 `[{q, a, ts}]`，最多 5 条，超出左弹出
  - TTL：600s（10 分钟，可配置），每次读写滑动续期（超时即重置）
- **关键流程**：问答前 `GET` 拼入 FastGPT chat 请求 histories；回答后 `LPUSH/LTRIM + EXPIRE` 写回。
- **接口定义**：`Context.get(key): Turn[]`、`Context.append(key, turn)`。

### M4 问答编排模块
- **职责**：组装请求调用 FastGPT Chat API（`/api/v1/chat/completions`，chatId 复用隔离键），解析置信度（FastGPT 返回的引用得分/相似度），低置信拒答，组装"答案+来源引用"格式。
- **关键流程**：取上下文 → 调 FastGPT（硬超时 15s 可配置，仅作用于异步补发路径；同步路径性能预算 5.5s，重试 1 次，指数退避 1s）→ 判定：最高分 ≥ 阈值（默认 0.75，可配置）→ 通过：答案 + `—— 来源：《文档名》`（最多 2 条）；低于阈值 → 固定拒答话术："抱歉，这个问题超出了我的知识范围，已为您记录，稍后由人工补充解答。" 并触发 M5。
- **接口定义**：`QA.ask(query, ctxKey, histories): {answer, score, sources[], hit:boolean}`。

### M5 未命中记录模块
- **职责**：未命中/低置信问题落库，支持导出 Excel（xlsx）。
- **关键流程**：M4 hit=false → 异步入库（不阻塞回复）→ 管理接口按时间段查询/导出。
- **接口定义**：`MissRecord.save({question, chatid, userid, score, status})`；`GET /admin/miss-records?from=&to=&format=xlsx`（Basic Auth）。
- **导出形态确认**：API + Basic Auth 直接返回 xlsx 文件流（Content-Disposition 附件），不做 Web 页面；操作手册提供 curl 与浏览器直接访问示例；管理页面归二期，本期 25 人天基线不变。

### M6 敏感词过滤模块
- **职责**：出站回答文本经 Aho-Corasick 多模式匹配过滤；词库文件热更新；拦截策略。
- **关键流程**：启动加载 `config/sensitive-words.txt` 构建 Aho-Corasick 自动机 → `fs.watch` 监听文件变更自动重建（原子切换）→ 命中即整段替换为固定话术："抱歉，该内容不便回复，请联系人工客服。"并记 WARN 日志（不含原文上下文）。
- **接口定义**：`Filter.check(text): {pass:boolean, filteredText}`。

### M7 配置与密钥管理模块
- **职责**：统一配置加载（.env + config 文件），启动时校验必填项（Token/AESKey/CorpID/Secret/FastGPT APIKey/LLM Key）缺失即 fail-fast 退出；密钥仅经环境变量注入，禁止写日志。
- **接口定义**：`ConfigService.get(key)`；启动自检输出"配置项存在性"清单（值打码）。

### M8 多媒体处理模块【增项包，对应 PRD FR-9/FR-10】
- **职责**：入站多媒体处理（图片识别转文本提问、语音/视频/文件引导兜底）与出站素材外发（链接/文件/视频消息）。
- **入站图片流程**：M2 判定 @机器人 且 MsgType=image → M1 `downloadMedia` → 调通义 qwen-vl（复用通义 fallback 账号，硬超时 10s；提示词固定："提取图片中与咨询/操作相关的文字，归纳为一句中文问题；无有效内容时仅返回 [NO_TEXT]"）→ 识别结果替换问题文本，交 M3/M4 走正常问答链路（上下文/置信度/拒答/过滤全复用）→ 返回 [NO_TEXT] 或调用失败时回复引导话术。图片识别路径全程异步（走主动发消息补发通道，不占用被动 5s 窗口与文本 8s 性能预算）。
- **语音/视频/文件入站**：不下载不解析，直接回复引导话术 + miss_record 落库（media_type 标记 voice/video/file）。
- **素材外发流程**：M4 收到答案后正则提取 `[[素材:<uuid>]]`（`\[\[素材:([a-f0-9-]+)\]\]`） → 查 asset 表（enabled=true）→ 剥离标记先发文本答案（@提问人）→ 逐个发送素材：link → `sendText`（标题 + URL）；file/video → `uploadMedia` 后 `sendFile`/`sendVideo` → 任一素材发送失败即补发降级提示话术并记 WARN。单条答案素材上限 2 个；文件 ≤20MB、视频 ≤10MB，超限直接走降级路径。
- **素材管理**：管理接口（Basic Auth，与 miss-records 一致）：`POST /admin/assets`（multipart 上传文件/视频，或 JSON 提交链接）、`GET /admin/assets`（清单）、`DELETE /admin/assets/:id`（逻辑停用）。素材文件存宿主机 `data/assets/`，纳入每日备份。
- **接口定义**：`Media.recognize(mediaId): {question}`；`AssetStore.resolve(ids): Asset[]`；`AssetSender.send(chatid, asset): SendResult`。

### M9 授权许可模块【交付方权益保护，不单独计价】
- **职责**：离线证书（license）验证，将系统运行约束在授权范围内：仅限授权服务器使用、有效期控制、管理群数量上限（硬性要求：系统只能在这台服务器上使用）。
- **证书设计**：`license.lic` = JSON payload + Ed25519 签名（交付方私钥签发，验签公钥随适配层内置；成品系统交付不含源码，私钥与签发工具仅存交付方）。payload 字段：
```json
{
  "license_id": "CSBOT-2026-001",
  "fingerprint": "<sha256(机器指纹)>",
  "issued_at": "2026-10-11",
  "expires_at": "2027-10-11",
  "max_chats": 15,
  "features": ["base", "media_asset"]
}
```
- **机器指纹**：采集 CPU 型号 + 主板/产品 UUID + 主网卡 MAC + 系统盘序列号的稳定项做 SHA-256。Docker 部署下取宿主机指纹（只读挂载 `/etc/machine-id` 等），容器重建不变化。部署脚本采集指纹输出"授权申请码"（指纹哈希），交付方据此签发证书——换机即失效。
- **验证时机与流程**：
  1. **启动强校验**：证书缺失 / 验签失败 / 指纹不符 → fail-fast 拒绝启动（日志说明原因）。
  2. **运行期复核**：每日 03:00 定时复核 + 回调处理前读内存缓存校验结果（TTL 1h，过期重验）；发现证书过期或指纹变化（换机/换网卡）→ 进入受限模式。
  3. **时间回拨防护**：最近一次成功校验的时间戳持久化到 `license.state`；当前系统时间早于该值即判定回拨异常，视为证书无效（防改系统时钟绕过有效期）。
- **受限模式行为**：`/healthz` 置 unhealthy；群消息回调仅回复固定话术"系统授权已到期或本机未获授权，请联系服务商处理"，不进入问答链路（不消耗 LLM 调用）；FastGPT 后台等功能不受此限（知识运营可继续整理语料）。
- **到期提醒**：距 `expires_at` ≤ 15 天时，每日一次经运维群 webhook 告警提醒续期。
- **群数上限**：目标群清单数量 > `max_chats` 时，新增群拒绝接入并告警；已接入群不受影响（避免续期衔接期业务中断）。
- **续期流程**：客户经管理接口导出授权申请码 → 交付方签发新证书 → 客户替换 `/opt/cs-bot/license/license.lic` 后 `POST /admin/license/reload` 热生效（或重启）。
- **反编译防护（混淆 + 原生混编，V1.4 新增）**：适配层为 Node.js/TypeScript，即使不交付源码，容器镜像中的 JS 产物仍可被提取反推。采用两层加固：
  1. **构建期混淆（全量 JS 产物）**：CI 构建管线在 `nest build` 之后接 **javascript-obfuscator**（terser 预压缩）：
     - 控制流扁平化（controlFlowFlattening）+ 死代码注入（deadCodeInjection），还原业务逻辑结构；
     - 字符串阵列加密（stringArray + rotate + rc4/base64 变换），内置验签公钥、话术常量、内部接口路径不以明文出现；
     - 标识符重整（identifierNamesGenerator: hexadecimal）+ 自卫代码（self-defending，格式化/改写即失效）；
     - **sourcemap 只存交付方内部制品库，部署镜像不携带 .map 文件**（构建脚本强制剔除）。
     - 代价说明：包体积 +30%~80%，冷启动 +0.5~1s，对 4C8G 与日活规模无实质影响；混淆项逐项开关，出问题可回退单项。
  2. **核心授权逻辑原生混编（Rust 编译 .node 原生模块）**：license 验签、指纹采集、时间回拨比对等 M9 核心判定**不落在 JS 层**，用 Rust 实现经 **napi-rs** 编译为平台专属 `.node` 二进制（`prebuilds/linux-x64`），JS 侧仅经 N-API 调用拿到布尔结果与错误码：
     - Ed25519 验签公钥、指纹拼接算法、`license.state` 读写逻辑全部封装在原生二进制内（strip 符号表，不附调试信息）；
     - 原生层内嵌自校验：JS 侧传入的待验签 payload 需与原生层重新序列化比对，防 JS 层篡改入参绕过；
     - 反调试：检测 `NODE_OPTIONS=--inspect/--inspect-brk`、strace/gdb 附加（ptrace 父进程检测）→ 直接返回验证失败并写告警日志；
     - 逆向 Rust 二进制需要专业工具链与成本，验签逻辑不会随 JS 反编译外泄。
  3. **镜像层加固**：适配层镜像基于 distroless/多阶段构建，最终镜像不含 npm 源、.ts、.map；镜像按 digest 分发，交付包附 SHA-256 校验值，客户侧重算不一致则拒绝 `docker compose up`（防镜像被中途替换注入）。
- **密钥与防护边界**：签发私钥仅存交付方；配合上述混淆+原生混编，本机制为**增强约束级**防护——可有效防：正常复制部署、超期使用、超量接入、通用工具（unpkg/js-beautify/文本搜索）反推逻辑；不承诺对抗专业级定向逆向（IDA/Ghidra 级原生分析、动态插桩），如需该强度另行评估（原生壳/VMP/加密狗）。
- **接口定义**：`License.verify(): {valid, reason, expiresAt, maxChats}`；`GET /admin/license`（授权状态/剩余天数/指纹哈希）；`POST /admin/license/reload`。

### M10 历史聊天记录导入模块【增项包，对应 PRD V1.2 FR-11】
- **职责**：把历史会话文件（企微会话存档导出 / 客服整理表格）转为可入库的问答语料：解析 → 清洗 → QA 配对 → 脱敏 → 敏感剔除 → 生成审核清单 → 人工审核确认 → 写入 FastGPT 独立数据集；支持按批次下线回滚。
- **处理管线（8 步，后台异步任务）**：
  1. **上传与校验**：管理接口 multipart 上传；扩展名白名单（.json/.csv/.txt/.xlsx）+ 大小 ≤ 200MB + 内容嗅探（识别企微存档 JSON 结构或"时间/说话方/内容"三列式表头）；文件落 `data/import/{jobId}/source.*`（0600）。
  2. **解析**：xlsx 用 exceljs 流式逐行读；csv/txt 流式解析；企微存档 JSON 按 message 数组流式读取。逐条处理即释放，峰值内存 < 200MB（与 adapter 512M 限额匹配），避免 OOM。
  3. **清洗**：按 `config/import-rules.yml`（可维护）剔除系统消息（入群/退群/撤回）、占位消息（图片/语音/视频/文件/表情）、机器人自身消息、刷屏重复（同发送方 60s 内重复仅留 1 条）、无实义短消息（有效字符 < 4）。
  4. **会话切分与 QA 配对**：按（会话标识 + 客户标识）分组，时间间隔 > 30 分钟切分会话窗口；窗口内客户侧连续消息聚合为"问"，其后客服侧首条实质回复（长度 ≥ 6 字、非纯表情/感谢）为"答"；同话题多轮合并（问取首条、答取末条）；单边消息入未配对池（不自动入库，可在清单中人工补配）。
  5. **脱敏（强制且前置）**：正则规则集（手机号 `1[3-9]\d{9}`、身份证 18 位、银行卡 16–19 位、详细地址、姓名模式）替换为 `[手机号]` 等占位符；会话/客户标识 SHA-256 截断哈希。**脱敏在任何清单生成与日志落盘之前完成——原始正文永不落日志**。
  6. **敏感剔除**：命中 `config/import-blacklist.txt`（价格/折扣承诺、优惠政策、内部制度、法律与赔偿承诺、竞品贬损、脏话）的问答对置 `auto_blocked=true`，不进"建议保留"集、不可批量通过。该黑名单与 M6 出站词库**相互独立**：M6 管出站拦截，此处管入库准入。
  7. **去重**：批次内 `source_hash`（问+答归一化后 SHA-256）唯一约束保证幂等（重复导入不产生重复数据）；与现有知识库比对——以"问"调 FastGPT 检索接口取 top1，score ≥ 0.9 记 `similar_qa_id` 并默认建议丢弃（近似已有）。
  8. **审核清单与入库**：生成 `review.xlsx`（列：序号/会话哈希/发生时间/问题/答案/脱敏标记/敏感标记/近似已有/建议动作/审核结果），运营员逐条填「保留 / 修改后保留 / 丢弃」后经幂接口提交；系统**仅对审核通过条目**调 FastGPT 数据集 API 写入（每批 50 条，失败指数退避重试 3 次），回写 `import_item.imported_qa_id`。
- **数据集隔离与回滚**：导入条目写入 FastGPT 独立 collection `历史语料-{jobId}`（推荐；如受 FastGPT 版本能力限制，则用统一 collection + `batch_id` 标签，实施时确认）。批次下线 = 删除该 collection（或按标签批量删除）+ 触发检索缓存刷新，无需重启服务。
- **任务与进度**：适配层进程内任务队列，**单任务并发**（避免导入挤占问答资源）；`import_job` 记录各阶段计数与状态，接口轮询查询；失败条目单列可重试，重试幂等（已入库条目按 `source_hash` 跳过）。
- **清理策略**：任务结束（含失败）后立即删除 `data/import/{jobId}/source.*`（原始文件不留存）；`review.xlsx` 保留 30 天由 03:40 定时任务清理；**"丢弃"条目的问答正文不落库**（仅记 `source_hash` 与状态），保留/入库条目正文随知识库保存。
- **安全**：接口走管理基线（Basic Auth + 来源 IP 白名单）；上传文件类型/大小/内容三重校验；导入全程在客户私有化环境内完成，不外传任何原始数据；导入任务不计入 M9 授权群数上限。
- **与既有模块关系**：入库后的答案在出站时仍经 M6 过滤；历史语料入库不改变 M5 未命中落库逻辑（可用导入后 miss_record 变化观察命中率提升）。
- **接口定义**：
  | 方法 | 路径 | 说明 |
  |---|---|---|
  | POST | /admin/import-jobs | 上传会话文件创建导入任务（multipart），返回 jobId |
  | GET | /admin/import-jobs | 批次列表（状态与统计） |
  | GET | /admin/import-jobs/:id | 任务进度（已解析/已配对/待审核/已入库/失败） |
  | GET | /admin/import-jobs/:id/review.xlsx | 下载审核清单（已脱敏，30 天内有效） |
  | POST | /admin/import-jobs/:id/confirm | 提交审核结果（JSON 或回传清单），触发批量入库 |
  | POST | /admin/import-jobs/:id/rollback | 批次下线（移出检索，可再次上线） |
  | POST | /admin/import-jobs/:id/retry | 失败条目重试 |
- **数据表**：`import_job`、`import_item`（见 §7.1）。

### M11 平台控制面与 SaaS 租户管理模块【增项包 C，对应 PRD V1.3 FR-12】
- **职责**：SaaS 形态下的平台侧能力——租户开通编排、租户注册表与元数据、配额计量与报表、订阅有效期管控、批量升级编排、监控告警聚合、运维访问审计。**控制面不存储租户知识库正文与问答日志**（只存元数据与计数），避免平台成为数据集中风险点。
- **租户开通编排（Provisioner）**：
  1. 输入：租户名、联系人、订阅周期、配额档位、企微 corpId（后补）、域名前缀。
  2. 编排步骤：分配资源槽位 → 渲染实例 compose/env 模板（独立端口段、独立 DB 名 `tenant_{id}`、独立 Redis 实例、独立 Mongo db、独立数据目录 `/data/tenants/{id}/`）→ 初始化 schema 与管理员口令（随机生成、一次性展示）→ 申请/签发 TLS 证书（通配域 + SNI 或独立子域）→ 调用 M9 签发订阅期授权证书（绑定该实例指纹）→ 启动容器组并健康检查 → 写入注册表（状态 active）。
  3. 幂等与回滚：任一步骤失败即回滚已创建资源（保留现场供排查），注册表状态置 failed，支持重试与人工介入；开通耗时目标 ≤ 30 分钟（实际取决于证书签发与镜像拉取）。
- **租户隔离（强制）**：
  - 物理层：每租户独立容器组与独立数据库/Redis/Mongo 实例；不共享宿主机 PG 实例（避免同库多 schema 的越权风险与噪声邻居问题）。
  - 网络层：每租户独立 compose network；跨租户网络不可达；控制面仅经管理网段访问实例（无公网管理口）。
  - 密钥层：每租户独立 .env（企微/LLM/FastGPT 密钥），加密存储于控制面密钥库（AES-256 + 主密钥 KMS/文件权限 600）。
  - 应用层：租户域名 ↔ 实例绑定表唯一，回调按域名路由，禁止跨域名访问（Nginx map + 白名单）。
  - 验收口径：跨租户检索 0 命中（抽测 ≥ 20 条）。
- **配额与计量（Metering）**：
  - 配额维度：群数量上限、日消息量、文档数/QA 对数、素材存储 MB、LLM token 月度上限（可选）。
  - 采集：适配层每日汇总上报（只上报计数与资源摘要，**不上报正文**）→ 控制面写 `tenant_usage_daily`；实时拦截在适配层本地（本地计数器 + 配额下发）。
  - 行为：80% 预警（通知租户与运营）；群数达上限拒绝新群；日消息量达上限停止受理新消息并回配额提示（已有会话保留但不进入问答，与 `Daily message quota enforcement` 规格一致）；配额变更即时下发（接口或每日拉取）。
- **订阅与授权管控**：
  - 订阅状态机：trialing → active → grace(7天只读) → suspended(受限模式) → terminated。
  - 到期流程：T-30/15/7 天提醒（邮件 + 运维群）→ 到期进宽限期（只读：问答可用、不可改知识库/加群）→ 宽限期满签发失效证书或直接将 license 置过期 → 群内仅回续期话术（复用 M9 受限模式，零 LLM 消耗）。
  - 续费：控制面签发新订阅期证书 → 实例热加载，无需重建、数据不变。
- **批量升级与灰度（Upgrade Orchestrator）**：
  - 镜像版本矩阵管理；升级批次化（每批 ≤ 10% 实例或按租户档位分组），先金丝雀（1 个内部租户）→ 观察 24h（错误率/延迟）→ 全量。
  - 每租户升级前自动快照（pg_dump + 数据目录），失败自动回滚到上一版本镜像与快照；升级窗口选低峰（默认 02:00–04:00），提前 3 个工作日通知租户。
- **监控、告警与审计**：
  - 聚合各实例 `/healthz`、问答失败率、LLM 失败率、容器资源水位（`resources.cpuPct/memPct`）；实例异常自动重启并告警，资源水位连续 ≥ 阈值（默认 90%×3 次）推送 `tenant.alert`（不重启）。
  - 运维访问审计：跳板入口 + 每次进入实例记录（操作人/时间/租户/原因/时长），审计日志不可删改（只追加，异地留存 180 天）；默认不查看知识库与问答正文，故障排查需租户书面同意。
- **租户注销与数据删除（Offboarding）**：
  1. 发起需双方确认（控制面双签记录）；2. 生成导出包（知识库文档 + `assets` + `pg_dump` + config，加密交付）；3. 租户确认收货；4. T+7 删除实例、数据目录、备份与证书，写入删除确认单；5. 注册表置 terminated（仅保留名称/联系人/时间等最小元数据）。
- **控制面自身的高可用与边界**：控制面单实例 + 每日备份（控制面库很小）；控制面故障不影响已运行租户实例（实例自治，回调不依赖控制面）；控制面不参与消息链路（避免成为单点）。
- **接口定义**：
  | 方法 | 路径 | 说明 |
  |---|---|---|
  | POST | /platform/tenants | 创建租户并触发开通编排 |
  | GET | /platform/tenants | 租户列表（状态/配额/订阅到期日/用量摘要） |
  | GET | /platform/tenants/:id | 租户详情（实例信息、用量趋势、订阅状态） |
  | POST | /platform/tenants/:id/renew | 续期（签发新证书并热加载） |
  | PATCH | /platform/tenants/:id/quota | 调整配额（即时下发实例） |
  | POST | /platform/tenants/:id/suspend、/resume | 暂停/恢复服务（违约、到期、应急） |
  | POST | /platform/tenants/:id/export、/destroy | 导出数据包并签发一次性 confirmToken；destroy 双签 + 令牌后进入 offboarding，T+7 由 sweep 删除 |
  | POST | /platform/upgrades | 批量升级（批次、金丝雀、回滚） |
  | GET | /platform/usage | 平台总览（租户数/资源水位/异常实例） |
  | GET | /platform/audit-log | 运维访问审计日志查询 |
  | GET | /platform/audit-log/verify | 审计链完整性校验 |
  | POST | /platform/tenants/:id/provision | 触发开通编排（模板渲染/证书/授权/启动） |
  | POST | /platform/tenants/:id/restart | 重启租户实例 |
  | PUT | /platform/tenants/:id/secrets | 写入/轮换租户密钥（加密存储） |
  | POST | /platform/tenants/:id/credentials/handoff | 一次性领取生成的管理员/FastGPT 口令 |
  | POST | /platform/tenants/:id/shell-access | 记录运维 shell 访问审计（跳板调用） |
  | POST | /platform/sweep | 手动触发到期/宽限扫描 |
  | POST | /platform/report | 接收实例用量上报（Bearer token，无正文） |
- **数据表**：`tenant`、`tenant_quota`、`tenant_usage_daily`、`platform_audit_log`（见 §7.4 平台侧表）。

## 6. 关键流程时序（ASCII）

### 6.1 正常问答流程
```
群成员   企微云    Nginx    M1接入   M2路由   M3上下文   M4编排   FastGPT   DeepSeek   M6过滤
  │@机器人提问│      │        │        │         │        │         │          │        │
  │──────▶│回调POST│        │        │         │        │         │          │        │
  │       │───────▶│───────▶│验签解密│         │        │         │          │        │
  │       │        │        │───────▶│去重/触发/限流      │         │          │        │
  │       │        │        │        │────────▶│读近5轮  │         │          │        │
  │       │        │        │        │─────────────────▶│chat请求 │          │        │
  │       │        │        │        │         │        │────────▶│检索+编排 │        │
  │       │        │        │        │         │        │         │─────────▶│生成    │
  │       │        │        │        │         │        │◀────────│◀─────────│        │
  │       │        │        │        │         │写回上下文◀───────│答案+来源  │        │
  │       │        │        │        │◀────────────────│─────────────────────────────▶│AC 过滤
  │       │◀被动回复(加密)──│◀───────│        │         │        │         │          │◀通过
  │◀──────│        │        │        │        │         │        │         │          │
```

### 6.2 低置信拒答流程
FastGPT 返回最高分 < 0.75 → M4 采用拒答话术（不经 LLM 二次改写）→ M5 异步入库 → M6 过滤 → 正常回包。端到端不额外增加 LLM 调用，延迟不受影响。

### 6.3 消息去重流程
```
M1 → M2: SETNX dedup:{msgid} EX 172800
  ├─ 返回 1（首次）→ 正常处理，处理失败重试期间该键仍在，重复回调被挡
  └─ 返回 0（重复）→ 立即响应 success，不进入后续流程
```

### 6.4 异常降级流程
- **被动回复 5s 窗口将超时**：适配层内部计时 3.5s 未拿到答案 → 先回空 success → 答案就绪后走主动发消息 API 补发。
- **DeepSeek 超时/5xx**：FastGPT 模型配置中启用通义 fallback 通道重试 1 次；双通道均失败 → 回复"系统繁忙，请稍后再试"并告警。
- **Redis 不可用**：降级为无上下文单轮问答（M3 fail-open），去重降级为内存 LRU 短期去重。
- **FastGPT 不可用**：直接回复固定降级话术，不阻塞回调线程。

## 7. 数据设计

### 7.1 适配层业务表（PostgreSQL，schema=adapter）

**miss_record（未命中问题表）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| question | text not null | 用户原始问题（学习闭环依赖，留存已获 PRD 确认） |
| chatid | varchar(64) | 群 ID |
| userid | varchar(64) | 发言人企微 userid（非明文姓名） |
| score | numeric(4,3) | 最高相似度得分 |
| media_type | varchar(16) null | 触发消息为多媒体时的类型标记（voice/video/file，V1.2 增项；图片识别成功后按文本提问记录，为空） |
| status | smallint default 0 | 0未处理 1已补录 2忽略 |
| created_at | timestamptz default now() | |
索引：`(status, created_at)`。

数据合规约束（V1.1 修订，与 PRD FR-6 对齐）：
- **脱敏导出**：导出 Excel 中 userid 列做掩码展示（前 2 位 + ****，或配置为哈希截断），默认开启；原始值仅限客户授权管理员经数据库直查。
- **保留期 90 天**（配置项 MISS_RECORD_RETENTION_DAYS）：适配层每日 03:30 定时任务删除超期记录，失败记 WARN 并次日重试。
- 全部数据存于客户服务器，不出域；部署/交付手册注明"群消息数据属客户数据，客户方需在群公告/隐私告知中说明机器人处理规则"——告知义务归客户侧。

**关键词配置（无独立表）**
触发关键词由 `config/keywords.yml` 提供（Trie 前缀匹配），`POST /admin/keywords/reload` 热加载；不建 `keyword_trigger` 表。

**asset（素材表，V1.2 增项新增）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | serial PK | 素材编号，知识库答案以 `[[素材:id]]` 引用 |
| asset_type | varchar(16) not null | link / file / video |
| title | varchar(128) not null | 发送时的标题/说明（外发前经 M6 过滤） |
| url | text | link 类型：公众号文章等 URL |
| file_path | varchar(256) | file/video 类型：data/assets 下相对路径 |
| size | bigint | 字节数（上传时校验：文件 ≤20MB、视频 ≤10MB） |
| md5 | varchar(32) | 重复上传校验 |
| enabled | boolean default true | 停用后命中答案走降级提示 |
| created_at | timestamptz default now() | |
索引：`(asset_type, enabled)`。素材治理责任归客户方（与知识文档口径一致）。

**import_job（导入任务表，V1.5 增项新增）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | 任务/批次编号，对外 jobId |
| file_name | varchar(256) | 上传原文件名（仅内部追溯） |
| file_hash | varchar(64) | 源文件 SHA-256（同文件重复上传可直接提示） |
| source_type | varchar(16) | archive_json / xlsx / csv / txt |
| total_msgs | integer | 解析到的消息总条数 |
| parsed_msgs | integer | 解析成功条数 |
| paired_count | integer | 成功配对问答对数 |
| unpaired_count | integer | 单边消息进未配对池条数 |
| masked_count | integer | 脱敏命中条数 |
| blocked_count | integer | 敏感黑名单强制复核条数 |
| dedup_count | integer | 批次内去重 + 近似已有跳过条数 |
| approved_count | integer | 审核通过条数 |
| imported_count | integer | 实际入库条数 |
| failed_count | integer | 入库失败条数 |
| dataset_name | varchar(64) | 写入的 FastGPT collection 名（历史语料-{id}） |
| status | varchar(16) | uploaded/parsing/parsed/approved/partial/rejected/rolled_back/failed（内部阶段以 §7.1 计数列表达） |
| error | text null | 失败原因（不含正文） |
| created_by | varchar(32) | 管理员账号（Basic Auth 用户名，哈希存） |
| created_at / finished_at | timestamptz | |
索引：`(status, created_at)`。

**import_item（导入明细表，V1.5 增项新增）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| job_id | bigint FK import_job(id) | 批次 |
| source_hash | varchar(64) unique | 问+答归一化 SHA-256（幂等去重键） |
| question | text | 已脱敏问题 |
| answer | text | 已脱敏答案（"丢弃"条目不留存正文，写 NULL） |
| session_hash | varchar(32) | 会话标识哈希（不可逆） |
| occurred_at | timestamptz | 原对话发生时间 |
| auto_blocked | boolean default false | 命中敏感黑名单，强制人工复核 |
| similar_qa_id | varchar(64) null | 现有知识库近似条目标识（score ≥ 0.9） |
| review_status | varchar(12) | pending / approved / modified / rejected |
| review_note | varchar(128) null | 审核备注或失败原因 |
| imported_qa_id | varchar(64) null | FastGPT 侧 QA 记录 ID（回写，用于回滚定位） |
| created_at | timestamptz | |
索引：`(job_id, review_status)`、`(source_hash)`。合规约束：question/answer 入库前已脱敏；rejected 条目正文不落库；明细元数据保留 180 天后清理。

### 7.2 Redis 键设计
| Key | 类型 | TTL | 说明 |
|---|---|---|---|
| `dedup:{msgid}` | string | 48h | 消息去重幂等 |
| `ctx:{chatid}:{userid}` | string(JSON) | 600s 滑动 | 近 5 轮上下文 |
| `ratelimit:{chatid}` / `ratelimit:{chatid}:{userid}` | string(计数) | 60s | 限流窗口 |
| `wecom:access_token` | string | 7000s | 企微凭证缓存 |

### 7.3 FastGPT 侧数据说明
知识库文档、切分段落、向量（bge embedding，pgvector）、会话记录均由 FastGPT 在其 MongoDB + PostgreSQL 中自管理；适配层不直接读写，仅经 API 交互。人工补录 = 运营人员在 FastGPT 后台将 miss_record 导出问题整理进知识库，无系统对接。

### 7.4 平台侧表（SaaS 形态，存于控制面独立数据库，仅元数据）

> 以追加式迁移为准（`apps/adapter/src/platform/007,008,011,012,015,016,017-*.sql`），下表为字段摘要。

**tenant（租户注册表）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | 租户 ID（gen_random_uuid） |
| name | varchar(255) | 租户名称 |
| status | varchar(30) | created / provisioning / active / grace / suspended / paused / terminated / provisioning_failed |
| host / port | varchar(255) / integer | 实例地址与端口（`tenant_port_seq` 从 30000 步长 10） |
| database_url | text | 租户独立 DB 连接串（provisioned 后填充） |
| contact | varchar(255) | 联系人（升级/到期通知，017 增补） |
| credentials_handed_at | timestamptz | 凭证一次性交接时间（016 增补） |
| expired_at | timestamptz | 订阅/授权到期 |
| last_provision_log | text | 最近一次编排输出（排障） |
| created_at / updated_at / deleted_at | timestamptz | |

**tenant_quota（租户配额）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| tenant_id | uuid UNIQUE → tenant | |
| max_chats / max_storage_mb / max_api_calls / max_users | integer | 群数 / 存储 MB / API 调用 / 用户数上限（0=不限） |
| max_llm_tokens_per_month | integer | 月度 token 上限（0=不限） |
| max_docs / max_qa / max_asset_mb | integer | 文档数 / QA 对数 / 素材容量（016 增补，0=不限） |
| created_at / updated_at | timestamptz | 变更即下发实例 |

**tenant_usage_daily（用量日报，仅计数）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| tenant_id + day | uuid + date（UNIQUE） | 租户与日期 |
| chat_count / api_call_count / storage_bytes / user_count | integer/bigint | 基础计数 |
| msgs_triggered / qa_hit / qa_miss | integer | 触发与命中（011 增补） |
| llm_tokens / active_chats | bigint / integer | token 与在服群数（011） |
| asset_mb / doc_count / qa_count | numeric/integer | 容量水位（011/016） |

**platform_audit_log（运维审计，只追加，链式）**
| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid PK | |
| seq | bigserial | 插入顺序（审计链按此串接） |
| tenant_id | uuid null | 目标租户 |
| action | varchar(100) | 见 `platform-audit` 规格动作词表 |
| actor | varchar(255) | 操作者标识 |
| payload | jsonb | 操作详情（含 `reason`，由 `PlatformReasonGuard` 注入） |
| prev_hash / hash | varchar(64) | 链式哈希（sha256(prev_hash+action+actor+payload+created_at)） |
| created_at | timestamptz | 保留 180 天，清理前导出异地 |

**其他平台表**（详见迁移）：`tenant_snapshot`、`tenant_upgrade_batch`（008）、`tenant_offboarding`、`tenant_destroy_confirmation`（015）。

## 8. 接口设计

### 8.1 企微回调接口（入站）
`POST /wecom/callback?msg_signature=xx&timestamp=xx&nonce=xx`
- 请求体：企微加密 XML（Encrypt 字段）。
- 响应：被动回复加密 XML；或纯文本 `success`（静默/去重/异步补发场景）。
- GET 同 URL：企微 URL 有效性验证（echostr 解密回显）。

### 8.2 FastGPT 调用契约（出站）
`POST {FASTGPT_BASE}/api/v1/chat/completions`，Header：`Authorization: Bearer {FASTGPT_API_KEY}`
```json
{
  "chatId": "group:{chatid}:{userid}",
  "stream": false,
  "detail": true,
  "messages": [{"role": "user", "content": "报销流程是什么？"}],
  "histories": [{"role":"user","content":"..."},{"role":"assistant","content":"..."}]
}
```
响应（摘取）：
```json
{
  "choices": [{"message": {"role":"assistant","content":"报销流程为……"}}],
  "responseData": [{"moduleType":"datasetSearchNode","quoteList":[{"source":"财务制度.pdf","score":0.83}]}]
}
```
适配层取 `choices[0].message.content` 为答案、`quoteList` 最高分做置信度判定、`source` 组装来源引用。硬超时 15s（可配置，仅作用于异步补发路径）、重试 1 次（指数退避 1s）。

### 8.3 适配层内部 API
| 方法 | 路径 | 说明 |
|---|---|---|
| GET/POST | /wecom/callback | 企微回调（M1） |
| GET | /healthz | 健康检查（容器 + compose） |
| GET | /admin/miss-records?from&to&format=xlsx | 未命中导出：Basic Auth，直接返回 xlsx 文件流，不做 Web 页面（V1.1 确认） |
| POST | /admin/keywords/reload | 触发关键词热加载 |
| POST | /admin/config/reload | 配置热加载（阈值/超时/话术） |
| GET | /admin/usage | 用量计数查询 |
| GET | /admin/config-check | 配置自检（值打码） |
| POST | /admin/assets、GET /admin/assets、GET /admin/assets/:id、DELETE /admin/assets/:id | 素材上传（multipart/JSON）/清单/详情/删除，Basic Auth（V1.2 增项） |
| GET | /admin/license | 授权状态查询：有效性/剩余天数/群数上限/指纹哈希（V1.3） |
| POST | /admin/license/reload | 证书热重载，续期后免重启生效（V1.3） |
| POST | /admin/import-jobs、GET /admin/import-jobs、GET /admin/import-jobs/:id | 历史会话导入：上传创建任务/批次列表/进度查询，Basic Auth（V1.5 增项） |
| GET | /admin/import-jobs/:id/review.xlsx | 下载审核清单（已脱敏） |
| POST | /admin/import-jobs/:id/confirm | 提交审核结果并触发批量入库（V1.5 增项） |
| POST | /admin/import-jobs/:id/rollback | 批次下线回滚（V1.5 增项） |
| POST | /admin/import-jobs/:id/retry | 失败条目重试（V1.5 增项） |
| 其他 | `/admin/import-jobs/from-url`、`/:id/parse`、`/:id/items`、`/:id/approve-all`、`/:id/unpaired`、`/:id/unpaired/pair`、`DELETE /:id`、`/counts`、`/lock/release` | 导入配套端点（上传 URL、后台解析、条目/批量通过、补配、删除、计数、租约释放） |
| POST | /internal/tenant/sync | 控制面→实例的配额/状态同步（Bearer 内部 token） |
| — | /platform/* | 平台控制面接口（仅 SaaS 形态，独立服务，完整清单见 §M11 与 Swagger `/docs`，V1.6 增项 C） |

## 9. 安全设计

| 项 | 措施 | 级别 |
|---|---|---|
| 回调验签 | 严格按企微官方算法校验 msg_signature，失败 401 且不处理 | 强制 |
| 传输安全 | 全链路 HTTPS（Nginx TLS1.2+）；业务入口仅 `/wecom/callback`，另有 `/admin/*`（Basic Auth + IP 限制）与 `/healthz`；FastGPT 管理后台独立 8443（默认拒绝） | 强制 |
| 出站过滤 | 所有机器人回复必经 M6 自动机（Aho-Corasick）敏感词过滤，命中整段替换 | 强制 |
| 密钥管理 | 全部密钥 .env 注入，文件权限 600、属主为运行用户；禁止入库/入仓/入日志；FastGPT 后台口令强密码（`install.sh` 预检拒绝弱默认与 <12 位） | 强制 |
| 日志脱敏 | 日志中间件对手机号/身份证/姓名模式打码；正文（question/answer/content/text/reply）在所有级别经 pino redact + 模式掩码，不以原文落盘 | 强制 |
| 端口基线 | 443 公网（限回调/运营网段）+ 8443 仅运维网段（FastGPT 后台，默认 deny all）+ 22 白名单；PG/Mongo/Redis 绑定容器内网 | 强制 |
| 权限基线 | 容器非 root 运行；管理接口 Basic Auth + 来源 IP 限制 | 推荐 |
| 数据留存 | miss_record 保留期 90 天自动清理（V1.1 修订）；导出文件脱敏，交客户后删除本地副本 | 强制 |
| 历史语料导入 | 入库前强制脱敏（手机号/身份证/姓名/地址）+ 会话标识哈希；原始导入文件处理完即删；“丢弃”条目正文不落库；导入接口 Basic Auth + IP 白名单；原始正文不入日志（V1.5） | 强制 |
| 反逆向加固 | 部署镜像 JS 全量混淆（控制流扁平化+字符串加密+无 sourcemap）；M9 核心验签/指纹逻辑 Rust 原生模块承载；镜像 digest 校验：交付包附 `SHA256SUMS.txt`，`install.sh` 重算不一致即拒绝启动 | 强制 |
| 租户隔离（SaaS） | 每租户独立容器组/数据库/Redis/Mongo/数据目录/域名/密钥；独立网络且跨租户不可达；回调按域名+白名单路由；跨租户检索 0 命中验收（V1.6） | 强制 |
| 平台运维审计（SaaS） | 控制面不存租户正文；运维访问实例经跳板 + 审计留痕（人/时/租户/原因），日志链式防篡改、异地留存 180 天；查看知识库/问答正文需租户书面同意（V1.6） | 强制 |
| 平台密钥管理（SaaS） | 租户 .env 加密存储（AES-256，主密钥文件 600 或 KMS），控制面无公网管理口（V1.6） | 强制 |

## 10. 部署架构

### 10.1 Docker Compose 服务与资源分配（4C8G，预算 ≤6.5G）
| 服务 | 镜像 | 内存限额 | 说明 |
|---|---|---|---|
| nginx | nginx:1.27-alpine | 128M | TLS 终结/反代 |
| adapter | 自研镜像（node:20-alpine 基座） | 512M | 适配层，CPU 1.0 |
| fastgpt | fastgpt 官方镜像（锁定 tag） | 2.5G | embedding 走外部 API 时可下调 |
| mongo | mongo:7 | 1G | FastGPT 独占 |
| pg | pgvector/pg16 镜像 | 1.2G | 适配层+FastGPT 共用，独立 database |
| redis | redis:7-alpine | 512M | maxmemory 384M + allkeys-lru |
| watchtower（可选） | — | 64M | 镜像更新，可裁剪 |
| vllm（可选，增项 D） | vllm/vllm-openai 官方镜像 | GPU 显存独立（T4 16G/A10 24G）+ 2G 内存 | 本地推理，OpenAI 兼容端点接入 FastGPT；不占 4C8G 预算（需另配 GPU 服务器或 GPU 实例） |
| xinference（可选，增项 D） | xinf 轻量镜像 | 2C2G | 本地 embedding（bge-m3），FastGPT embedding 渠道指向本端点 |

> 上表限额已以 `mem_limit` 落在 `deploy/docker-compose.yml`；Redis 另配 `--maxmemory 384mb --maxmemory-policy allkeys-lru`，容器限额 512M 留出 fork/碎片余量。

> 资源档位（V1.8）：**云 API 档** = 基线 4C8G/6.5G 预算；**本地 GPU 档** = 8C16G + GPU（T4/A10/L4，Qwen2.5-7B/14B）；**本地 CPU 档** = 8C32G（仅 int4 小模型，低量兑底）。选型依据见 §4.3 规格对照表。

**网络分区与端口矩阵（V1.7 明确）**：全部服务在一个 compose 网络内通信，**仅 nginx 映射宿主机端口**：

| 端口 | 归属 | 暴露范围 | 用途 |
|---|---|---|---|
| 443/tcp | nginx（宿主映射） | 公网（建议防火墙限源：企微回调段 + 运营办公网段） | 企微回调 `/wecom/callback`、管理接口 `/admin/*` |
| 8443/tcp | nginx（宿主映射，`FASTGPT_ADMIN_PORT`） | 仅运维网段（`FASTGPT_ADMIN_ALLOW_CIDRS`，默认 deny all） | FastGPT 管理后台（知识运营） |
| 3000 | adapter | 仅内网 | 无宿主映射 |
| 3000 | fastgpt | 仅内网（后台经 nginx 8443 反代） | 无宿主映射 |
| 5432 | pg | 仅内网 | **禁止映射宿主**，运维临时经 `docker exec` |
| 27017 | mongo | 仅内网 | 同上 |
| 6379 | redis | 仅内网 | 同上 |
| 22/tcp | 宿主机 | 运维网段白名单 | SSH 运维（密钥登录） |

出站白名单（防火墙/安全组仅需放行）：`qyapi.weixin.qq.com:443`（企微 API）、`api.deepseek.com:443`（主 LLM）、`dashscope.aliyuncs.com:443`（通义 fallback 与 qwen-vl 视觉）；SaaS 形态追加控制面上报域名。其余出站一律默认拒绝。

### 10.2 目录结构（宿主机 /opt/cs-bot）
```
/opt/cs-bot
├── docker-compose.yml
├── .env                    # 600 权限
├── nginx/{nginx.conf,certs/}
├── config/{keywords.yml,sensitive-words.txt,import-rules.yml,import-blacklist.txt}
│                            # 触发词/出站词库；导入清洗规则与入库准入黑名单（V1.5）
├── license/license.lic,license.state  # 授权证书与校验状态（600 权限，V1.3）
├── data/{pg,mongo,redis,assets}/  # 卷挂载；assets 为素材目录（V1.2 增项），纳入每日备份
├── data/import/{jobId}/        # 导入临时区（原始文件，任务结束即删，不备份，V1.5）
└── backup/                 # 每日备份产物
```

### 10.3 备份策略与定时任务
- 每日 02:00 cron：`pg_dump`（两个 database）+ `mongodump` → /opt/cs-bot/backup，保留 7 天；知识库文档原件由客户侧留存。
- 每日 02:00（随备份任务）：素材目录 `data/assets` 打包增量备份（V1.2 增项）。
- 每日 03:30：miss_record 保留期（90 天）清理任务（V1.1 修订）。
- 每日 03:40：导入临时区与过期审核清单清理（残留 `data/import/*` 一律删除；review.xlsx 超 30 天删除；import_item 元数据超 180 天删除，V1.5）。
- Redis 不备份（上下文/去重可丢）。

### 10.4 监控告警
- 云厂商免费监控：CPU>85%、内存>85%、磁盘>85% 告警至客户运维。
- 容器 `healthcheck`（/healthz 与各依赖探活）+ `restart: unless-stopped`，异常退出自动重启；宿主重启后由 Docker 守护进程（`systemctl enable docker`）拉起。
- 适配层进程崩溃/重启、LLM 双通道连续失败 → 调用企微群机器人 webhook 推送告警到运维群。

### 10.5 SaaS 部署拓扑与资源规划（V1.6 增项 C）
- **选型结论**：不使用"共享实例 + 逻辑隔离"的多租户方案，而是**每租户一套独立实例**（"单实例多部署"，即虚拟私有化）。理由：① 隔离性与合规表述最强（数据物理分离，客户易接受）；② 代码零改造（复用现有 compose 模板，仅参数化）；③ 噪声邻居与资源争抢风险最小。代价是资源成本高于共享方案，按租户定价覆盖。
- **我方云资源规划（示例规模）**：
  | 规模 | 租户数 | 建议配置 | 说明 |
  |---|---|---|---|
  | 起步 | ≤ 5 | 2×8C16G（每台 3 租户 × 4C8G 配额，含控制面 1C2G） | 单机多实例用 cgroup 限额硬隔离；控制面可与租户实例同机（小规模），规模上来后拆分 |
  | 成长 | ≤ 20 | 8×8C16G 或 4×16C32G + 独立控制面 | 按租户档位调度（standard 4C8G / enhanced 8C16G） |
  | 扩展 | > 20 | 引入轻量调度（Docker Swarm 或 K8s） | 超出本期范围，届时改造 provisioner 后端即可（接口不变） |
- **每租户实例规格**：standard = 4C8G/100G SSD（同等私有化基线）；enhanced = 8C16G/200G SSD（大知识库/多群）。租户 compose 由 `ShellProvisioner` 渲染，六服务均写入 standard 档 `mem_limit`（nginx 128M / adapter 512M / fastgpt 2.5G / pg 1.2G / mongo 1G / redis 512M，合计 ≈5.9G），实现 cgroup 内存硬隔离；enhanced 档需按档位调整模板。
- **成本参考**（用于订阅定价，需按实际云商价格核对）：standard 单租户折算 ≈ ¥300–450/月（计算+存储+带宽+备份，不含 LLM API）；LLM API 按用量由租户自备 Key 或平台代付（建议平台代付、计入订阅档位，便于计量）。
- **备份与恢复**：每租户每日 02:00 快照（`scripts/backup-tenants.sh`：pg_dump + mongodump + data/license），保留 7 天，产物路径 `backup/tenants/{tenantId}/<YYYYmmdd_HHMMSS>/`；订阅期内 1 次按需恢复，使用 `scripts/restore-tenant.sh <tenantId> --yes`（默认只打印计划，需显式确认；恢复含 public schema 重建、mongorestore --drop、data/license 解包）。
- **发布与灰度**：镜像版本矩阵 + 分批升级（金丝雀 1 个内部租户 → 24h 观察 → 分批全量），每租户升级前自动快照，失败自动回滚（详见 M11）。
- **与私有化形态的运维差异**：私有化形态适配层不上报任何数据；SaaS 形态下适配层每日向控制面上报**计数类**用量（无正文），上报失败本地缓存 7 天后丢弃，不影响问答链路。

## 11. 非功能设计

### 11.1 性能预算（P95 ≤ 8s 分解）
| 环节 | 预算 |
|---|---|
| 企微回调网络 + Nginx | 0.5s |
| 验签/解密/路由/去重/限流 | 0.2s |
| 上下文读取（Redis） | 0.1s |
| FastGPT 检索 + DeepSeek 生成（非流式，含 fallback 余量） | 5.5s |
| 敏感词过滤 + 加密 + 发送 | 0.4s |
| 冗余 | 1.3s |
- 兜底：内部 3.5s 未就绪即转主动发消息通道（被动窗口保护），LLM 调用硬超时 15s（可配置，仅作用于异步补发路径，不影响 8s 同步指标）。
- 图片识别路径（V1.2 增项，FR-9）：整体 P95 目标 ≤ 12s（企微下载 ~1s + qwen-vl 识别 ~3s + 常规问答 7s + 冗余），全程走异步主动发消息通道，不影响文本问答 8s 指标。

### 11.2 可用性与降级
- 目标可用性：工作时间 ≥ 99%（单机部署，接受计划内维护窗口）。
- 降级矩阵：Redis 挂→无上下文单轮+内存去重；FastGPT 挂→固定话术；DeepSeek 挂→通义 fallback；双通道挂→繁忙话术+告警；适配层挂→容器 `restart: unless-stopped` 自愈 + 宿主 `systemctl enable docker`（RTO < 1min）；license 失效/过期→受限模式（仅授权提示话术，不进问答链路，V1.3）；导入任务运行中内存 > 80%→自动暂挂任务（保留断点，空闲后续跑，V1.5）。

### 11.3 限流参数
| 维度 | 阈值 | 行为 |
|---|---|---|
| 单群 | 20 条/分钟 | 超限静默，群内每 5min 最多提示一次 |
| 单人 | 5 条/分钟 | 超限回"提问太频繁，请稍后再试" |
| 全局出站 LLM | 并发 ≤ 4（信号量排队） | 保护 4C 资源与 LLM 配额 |
| 导入任务 | 单任务并发；解析批次 ≤ 2000 条/批，每批后强制释放 | 不与群内问答争资源；实时问答优先（V1.5） |

### 11.4 容量与高并发设计（V1.8 新增）

**并发模型与容量测算（4C8G 基线、云 API 档）**

| 层 | 瓶颈点 | 单机容量测算 | 结论 |
|---|---|---|---|
| Nginx | 连接/TLS | 单核万级 RPS | 远超需求，非瓶颈 |
| adapter | 事件循环（IO 密集） | 纯 IO 路径 ≥50 QPS；含管道开销实测目标 ≥20 QPS | 10 群日活场景（峰值触发 ~5 QPS）余量 4 倍 |
| Redis | 去重/上下文读写 | 单机 10 万+ QPS | 非瓶颈 |
| PG | miss_record 写入 + pgvector 检索 | 写 <10ms/条；检索毫秒级 | 5 万向量内非瓶颈 |
| **LLM 出站（主瓶颈）** | 并发信号量 ≤4 + API 限流 | 4 路 × 3600s/平均 7s ≈ **2000 次问答/小时** ≈ 0.55 QPS 触发态 | 决定系统吞吐上限；超量走限流+排队，洪峰按 §11.3 拦截 |

- **容量结论**：基线规格稳定支撑 **≥10 群、日有效问答 ≤5000 次、峰值触发 5 QPS**（PRD 并发指标），与 LLM 预算（DeepSeek）匹配；瓶颈在 LLM 而非自研组件，**加并发=加信号量+加 LLM 配额**，不改代码。
- 本地模型档：吞吐由 GPU 决定（7B/A10 ~10 路），等效 ~5000 次/小时，高于云档；纯 CPU int4 档仅适合日活 <500 的兜底场景。

**扩展路径（触发阈值 → 动作，均为配置/部署级，不改代码）**

| 阶段 | 触发条件 | 动作 | 改造量 |
|---|---|---|---|
| L1 垂直扩容 | P95 连续 3 天 >8s 或 CPU >80% | 4C8G → 8C16G；LLM 信号量 4→8 | 改 compose 资源限额 + .env |
| L2 adapter 水平扩 | 回调 QPS >20 或洪峰排队明显 | adapter 多副本（compose `--scale`），前置 Nginx 轮询；Redis/PG 共享 | compose 副本数，无状态已保证（上下文/去重全在 Redis） |
| L3 FastGPT 检索扩 | 知识库 >2000 篇或检索 P95 >1s | pgvector 拆专用 PG 实例 + HNSW 调参；FastGPT 多副本 | 迁移脚本 + compose 变更 |
| L4 平台化 | SaaS 租户 >20 | Compose → Swarm/K8s，Provisioner 换后端 | 仅 M11 编排层，接口不变 |

**高并发保护（已内置，与 §11.3 限流联动）**：回调层 msgid 去重（防企微重推放大）→ 触发层限流（单群 20 条/分、单人 5 条/分）→ 出站信号量（≤4）→ 被动 3.5s 超时转主动补发（不占回调线程）→ 洪峰期"静默优先、触发必答"策略。每层独立生效，单层失效不放大到下层。

### 11.5 可维护性设计（V1.8 新增）

| 维度 | 机制 |
|---|---|
| 配置化 | 触发词/置信度阈值/超时/话术/保留期/限流参数均 .env 或 config 文件，改配置不改代码；词库热加载 |
| 模型可换 | 三档模型通道配置切换（§4.3）；LLM 热切、embedding 切换走重建索引流程 |
| 升级与回滚 | 镜像 tag 锁定；升级前自动快照；失败回滚到上一 tag + 快照（部署手册 §9.3）；SaaS 金丝雀分批 |
| 观测 | /healthz 依赖探活；结构化日志（脱敏中间件）；问答日志含置信度与耗时字段，可定位慢请求 |
| 边界治理 | §3.4 模块依赖规则 R-1~R-8 + Nest module 边界，代码评审 checklist |
| 单代码基 | 双形态共用镜像矩阵，配置层差异（compose 模板 + env），不维护分支 |
| 知识沉淀 | 本文档 ADR（§3.5）+ 选型对比矩阵（§4.2）+ 版本记录，决策可追溯 |
| 文档配套 | 部署手册（环境/安装/运维/排障）+ 操作手册（知识运营，含培训） |


## 12. 风险与应对（Top 8）

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| 1 | FastGPT 版本升级/API 变更导致不兼容 | 问答链路中断 | 锁定部署版本 tag，合同期内不升级；升级须经测试环境回归后方可变更 |
| 2 | DeepSeek API 抖动/限流 | 响应超时、命中率感知下降 | 通义 fallback 自动切换；超时与重试预算已含在 8s 内；连续失败告警 |
| 3 | 4C8G 资源瓶颈（多组件同机） | OOM、延迟劣化 | 内存限额硬隔离；embedding 优先外部 API 模式降内存；上线前 50 并发群消息压测验证 P95；预留裁剪 watchtower 预案 |
| 4 | 企微回调接口/加解密规范变更 | 消息收发中断 | M1 协议逻辑单模块封装，变更影响面可控；订阅企微开发者公告；验签失败告警 |
| 5 | 消息洪峰（大群刷屏/促销日） | 排队积压、超限 | M2 限流+全局并发信号量；去重拦截重复回调；洪峰期静默优先保证触发消息；事后按 miss_record 补录 |
| 6 | 历史语料导入与问答争抢 4C8G 资源 / 导入文件含敏感信息 | 问答延迟劣化；隐私合规风险 | 单任务并发 + 流式逐条解析（峰值内存 < 200MB）+ 内存超 80% 自动暂挂；入库前强制脱敏、原始文件即删、丢弃条目正文不落库；上线前小批（1 万条）压测确认（V1.5） |
| 7 | SaaS 形态下平台成为数据集中风险点 / 运营人员误访问租户数据 | 合规与信任风险 | 控制面只存元数据与计数，不落租户正文；实例级物理隔离 + 跳板访问 + 链式审计日志；查看正文需租户书面同意；签署数据处理与保密协议（V1.6） |
| 8 | SaaS 资源超卖/噪声邻居导致单租户体验下降 | SLA 不达标、口碑受损 | 不用共享实例超卖；每租户 cgroup 硬限额（租户 compose 六服务 `mem_limit` 已落地）+ 配额拦截；平台级监控水位与扩容预案；金丝雀升级 + 自动回滚（V1.6） |

---

## 13. 版本记录

| 版本 | 日期 | 说明 |
|---|---|---|
| V1.0 | 2026-10-11 | 初版 |
| V1.1 | 2026-10-11 | 与 PRD 对齐 3 项开放点：① miss_record 脱敏导出+90 天保留期+客户侧告知义务；② 触发关键词出厂默认值（客服：/客服,/请问：/咨询：）；③ 未命中导出确认为 API+Basic Auth xlsx 文件流，不做 Web 页面；④ 定时任务清单补充 03:30 清理任务 |
| V1.2 | 2026-10-11 | 新增 M8 多媒体处理模块（入站图片识别 qwen-vl + 素材外发）、asset 素材表、miss_record.media_type 字段、/admin/assets 管理接口、素材目录备份；对应 PRD V1.1 FR-9/FR-10 增项包（+3 人天 / +¥3,300） |
| V1.3 | 2026-10-11 | 新增 M9 授权许可模块（Ed25519 离线证书、机器指纹绑定、有效期与群数上限、时间回拨防护、受限模式与续期热加载）、/admin/license 接口、license 目录；属交付方内部授权约束，不写入对外 PRD 与报价单 |
| V1.4 | 2026-10-11 | M9 扩充反编译防护：① 构建期 javascript-obfuscator 全量混淆（控制流扁平化/字符串阵列加密/自卫代码/镜像剔除 sourcemap）；② M9 核心验签/指纹/回拨判定改由 Rust napi-rs 原生模块承载（公钥与算法入二进制、strip、防调试与防篡改入参）；③ 镜像 distroless 多阶段构建 + digest 校验防替换。防护边界由"商务约束级"升为"增强约束级"；内部加固措施，不写入对外文档 |
| V1.5 | 2026-10-11 | 新增 M10 历史聊天记录导入模块（会话文件流式解析、清洗、QA 配对、强制脱敏与敏感黑名单剔除、人工审核门禁、FastGPT 独立数据集入库、批次回滚、导入临时区清理），新增 `import_job`/`import_item` 表、`/admin/import/*` 接口、`config/import-rules.yml` 与 `import-blacklist.txt`；对应 PRD V1.2 FR-11 增项包（+3 人天 / +¥3,300） |
| V1.6 | 2026-10-11 | 新增 M11 平台控制面与 SaaS 租户管理模块（租户开通编排、实例级物理隔离、配额计量、订阅状态机与宽限期、批量升级金丝雀与回滚、运维审计、注销数据删除）；新增§3.3 双交付形态与部署拓扑、§7.4 平台侧表（tenant/tenant_quota/tenant_usage_daily/platform_audit_log）、§10.5 SaaS 资源规划与成本参考、安全设计 3 行（租户隔离/运维审计/平台密钥）、风险 7–8；对应 PRD V1.3 FR-8 双形态与 FR-12 增项包 C |
| V1.7 | 2026-10-12 | 架构明确化：§3.1 重绘为逻辑架构图并附数据流清单（D1–D10，含协议与约束）；新增 §3.4 核心处理链路（消息管道 ASCII 图 + 管理链路）与模块依赖规则 R-1~R-8（单一企微出口/单一 FastGPT 客户端/出站必经过滤/授权前置/配置统一/文件分区/不越层/导入不抢管道）；新增 §3.5 架构决策记录 ADR A1–A12（含被否备选与原因）；§10.1 补网络分区与端口矩阵（仅 443 对外，出站域名白名单）；各层职责补平台控制面行；配套新建《部署手册》V1.0（环境要求/企微配置/安装/验证/运维/故障排查/安全自查） |
| V1.9 | 2026-10-12 | 管理面交付形态口径明确：§3.4 管理链路补注"本期纯 API + 操作手册调用示例，不提供自研管理界面；管理接口可视化统一归二期独立运营后台，接口契约保持不变"；与 PRD V1.5 范围口径、报价单二期后台范围对齐 |
| V1.8 | 2026-10-12 | 选型与性能明确化：① 选型表按性能/并发/可维护性重述，新增 §4.2 关键选型对比矩阵（FastGPT vs Dify/LangChain、NestJS vs Go/Java、云 API vs 本地 vLLM、Compose vs K8s、不引入 Kafka，六维评分含被否原因）；② 新增 §4.3 本地模型嵌入设计（OpenAI 兼容端点接入、MODEL_MODE 三档路由 cloud/hybrid/local、模型规格与吞吐对照、embedding 切换须重建索引红线、增项包 D）；③ 新增 §11.4 容量与高并发设计（各层容量测算、LLM 为主瓶颈 ~2000 次/小时、L1–L4 扩展路径）与 §11.5 可维护性设计；④ §10.1 补 vllm/xinference 可选服务与三档资源档位；⑤ ADR 增 A13/A14 |
| V1.10 | 2026-10-29 | 文档契约对齐：导入接口统一为 `/admin/import-jobs`；关键词改为 `config/keywords.yml` 配置文件口径（无 `keyword_trigger` 表）；与详细设计 V1.2、部署手册 V1.2 同步 |
| V1.11 | 2026-10-29 | 细节对齐：限流改为按分钟固定窗口；素材标记改为 `[[素材:<uuid>]]`；与详细设计 V1.3 同步 |
| V1.12 | 2026-10-29 | R-2 落地为统一 `FastGPTClient`（问答/数据集/检索/collection 计数共用凭据与超时）；§11.2 双通道失败补告警与节流；自愈表述由 systemd 改为容器 restart + 宿主 docker 自启；R-3 收敛为「含动态内容的出站文本必须过 M6」 |
| V1.13 | 2026-10-29 | §10.1 内存限额以 `mem_limit` 落地（含 Redis maxmemory）；镜像版本对齐实际；§12 风险 4 补验签失败告警实现 |
| V1.14 | 2026-10-30 | §10.1 端口矩阵补 8443（FastGPT 管理后台，默认 deny、仅白名单网段）；修正 fastgpt 端口 3001→3000 |
| V1.15 | 2026-10-30 | §7.4 平台侧表按实际迁移重写（UUID 主键、status/host/port、payload 审计、配额维度），补充升级/快照/注销表清单 |
| V1.16 | 2026-10-30 | §9 端口基线含 8443 管理口、传输安全补 /admin 与 /healthz；M6 改为 Aho-Corasick 自动机 |
| V1.17 | 2026-10-30 | M11 补容器资源水位（healthz resources + 水位告警）；§8.3 与 M11 接口清单补全 |
| V1.18 | 2026-10-30 | §9 密钥管理/反逆向补齐安装器落地（SHA256SUMS 校验、强口令预检）；日志脱敏表述精确化 |
| V1.19 | 2026-10-30 | §10.5/§12：租户 compose 六服务写入 standard 档 `mem_limit`（合计 ≈5.9G），cgroup 内存硬隔离落地 |
| V1.20 | 2026-10-30 | §10.5 备份路径修正为 `backup/tenants/{tenantId}/`；补 `restore-tenant.sh` 按需恢复与确认机制 |
