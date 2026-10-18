# 微信群智能客服机器人 MVP — 部署手册

| 项 | 内容 |
|---|---|
| 文档名称 | 部署手册（私有化部署形态 A 为主，附 SaaS 形态租户开通） |
| 版本 | V1.1（V1.0 + 新增附录 D 本地模型部署与切换、模型通道三档配置项） |
| 日期 | 2026-10-12 |
| 适用对象 | 客户方 IT / 运维人员、交付工程师 |
| 适用系统 | 微信群智能客服机器人 MVP（对应《概要设计》V1.8） |
| 关联文档 | 《PRD V1.5》《概要设计 V1.9》《项目报价单》 |

> 本手册覆盖从环境准备到上线验证、日常运维与故障排查的完整流程。按顺序执行即可完成部署；**第 5 章准备清单全部就绪后再开始安装**，可避免中途卡壳。

---

## 1. 部署形态说明

| 形态 | 说明 | 本手册覆盖 |
|---|---|---|
| A 私有化部署 | 系统部署在客户自有云服务器，数据不出域，客户自行运维 | **正文全部章节** |
| B SaaS 托管 | 系统部署在交付方云上，客户免运维、按订阅使用 | 附录 A（租户开通，10 分钟） |

## 2. 部署架构概览

```
                    互联网
                      │ 443/tcp（唯一对外端口）
                      ▼
              ┌───────────────┐
              │ nginx 容器     │ TLS 终结 / 反向代理
              └───────┬───────┘
                      │ compose 内网
        ┌─────────────┼──────────────┬─────────────┐
        ▼             ▼              ▼             ▼
   ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌─────────┐
   │ adapter │  │ FastGPT  │  │ PostgreSQL│  │ MongoDB │
   │ 适配层   │  │ 问答中枢 │  │ +pgvector │  │         │
   └────┬────┘  └────┬─────┘  └─────┬─────┘  └─────────┘
        │  ┌─────────┘              │
        ▼  ▼                        │
   ┌──────────┐                ┌────▼─────┐
   │  Redis   │                │（数据卷） │
   └──────────┘                └──────────┘
        出站（HTTPS，仅白名单域名）：企微 API / DeepSeek / 通义
```

**组件清单（6 个容器）**

| 组件 | 镜像 | 内存限额 | 用途 |
|---|---|---|---|
| nginx | nginx:1.25-alpine | 128M | TLS 终结、反代、请求体限制 |
| adapter | 交付方自研镜像（锁定 tag） | 512M | 适配层（消息管道/管理接口） |
| fastgpt | fastgpt 官方镜像（锁定 tag） | 2.5G | 知识库、检索、问答编排、运营后台 |
| pg | pgvector/pg15 | 1.2G | 业务表 + 向量库（两个 database） |
| mongo | mongo:6 | 1G | FastGPT 元数据 |
| redis | redis:7-alpine | 512M | 上下文/去重（可丢，不备份） |

**端口矩阵**：仅 443 对外；3000/3001/5432/27017/6379 全部只在容器内网，**不映射宿主机**；SSH 22 限运维网段。

## 3. 环境要求

### 3.1 硬件

| 项 | 最低 | 推荐 |
|---|---|---|
| CPU / 内存 | 4C / 8G | 8C / 16G（知识库 > 500 篇或群 > 15 个时） |
| 磁盘 | 100G SSD | 200G SSD（预留备份与素材空间） |
| 带宽 | 5M | 10M（含素材外发） |
| GPU（仅本地模型档，增项 D） | 无（云 API 档不需要） | T4 16G（7B int4）/ A10、L4 24G（7B fp16 或 14B） | 详见附录 D；纯 CPU 8C32G 仅低量兑底 |

### 3.2 软件依赖

| 项 | 要求 | 检查命令 |
|---|---|---|
| 操作系统 | Ubuntu 22.04 LTS / Rocky 9（x86_64） | `cat /etc/os-release` |
| Docker | ≥ 24.0 | `docker version` |
| Docker Compose | v2 ≥ 2.20（compose 插件） | `docker compose version` |
| 时间同步 | NTP/chronyd 开启（时间回拨会影响授权校验） | `timedatectl` |
| 时区 | Asia/Shanghai | `timedatectl set-timezone Asia/Shanghai` |
| swap | ≥ 4G（防突发 OOM） | `free -h` |

### 3.3 网络与防火墙

- **入站**：仅开放 443/tcp（建议来源限制为企微回调网段 + 运营办公网段）；22/tcp 仅运维网段。
- **出站白名单**（其余默认拒绝）：

| 域名 | 端口 | 用途 |
|---|---|---|
| qyapi.weixin.qq.com | 443 | 企微 API（发消息/素材） |
| api.deepseek.com | 443 | 主 LLM |
| dashscope.aliyuncs.com | 443 | 通义 fallback / qwen-vl 视觉（增项 A） |

### 3.4 域名与证书

1. 一个已 **ICP 备案**的域名（如 `bot.example.com`），备案周期 2–3 周，需最提前启动。
2. TLS 证书：可用免费 DV 证书（Let's Encrypt / 云厂商免费证书）或商用证书； PEM 格式（fullchain + key）。
3. DNS A 记录解析到服务器公网 IP。

## 4. 目录规划

统一部署在 `/opt/cs-bot`：

```
/opt/cs-bot
├── docker-compose.yml          # 编排文件（部署包自带）
├── .env                        # 全部配置项（600 权限，含密钥）
├── nginx/nginx.conf            # 反代配置（部署包自带，按域名改 server_name）
├── nginx/certs/fullchain.pem, privkey.pem
├── config/keywords.yml         # 触发关键词（出厂默认 + 可自行增删）
├── config/sensitive-words.txt # 出站敏感词库（可自行增删，热加载）
├── config/import-rules.yml    # 历史导入清洗规则（增项 B）
├── config/import-blacklist.txt# 导入准入黑名单（增项 B）
├── license/license.lic         # 授权证书（交付方签发）
├── data/pg/  data/mongo/  data/redis/   # 数据卷（容器挂载）
├── data/assets/               # 素材目录（增项 A，纳入备份）
├── data/import/               # 导入临时区（自动清理，勿手动放文件）
└── backup/                    # 每日备份产物（保留 7 天）
```

## 5. 部署前准备清单（客户侧）

| # | 事项 | 责任 | 就绪标志 |
|---|---|---|---|
| 1 | 服务器就绪（4C8G、Ubuntu 22.04、Docker+Compose） | 客户 | `docker compose version` 正常输出 |
| 2 | 域名 + ICP 备案 + DNS 解析 + TLS 证书 | 客户 | `https://<域名>` 可访问（临时页面即可） |
| 3 | 防火墙/安全组按 §3.3 配置 | 客户 | 端口扫描仅 443/22 开放 |
| 4 | 企业微信主体认证 + 创建自建应用 | 客户（交付方指导） | 拿到 CorpID / Secret / AgentId |
| 5 | 企微应用配置接收消息（Token/AESKey/回调 URL） | 客户 + 交付方联调 | 见 §6 |
| 6 | DeepSeek API Key（已充值）+ 通义 API Key（备） | 客户 | Keys 可用（部署后 config-check 验证） |
| 7 | 授权申请码已提交、`license.lic` 已收到 | 客户 ↔ 交付方 | 交付方返回证书文件 |
| 8 | 首批知识文档（≥ 1 批）与触发词清单确认 | 客户业务方 | 文档可上传（上线后） |

## 6. 企微后台配置（摘要）

1. 企微管理后台 → 应用管理 → 创建**自建应用**，记录 `CorpID`、`Secret`、`AgentId`。
2. 应用「接收消息」→ 设置 API 接收：
   - URL：`https://<域名>/wecom/callback`
   - Token、EncodingAESKey：自动生成并记录（填入 .env）
3. 应用「网页授权及 JS-SDK」→ 设置可信域名 `<域名>`。
4. 「客户联系 → 客户群」中把机器人应用加入目标客户群（或由群主扫码邀请）。
5. 服务器侧完成部署后（§7），回到该页面点「保存」完成回调校验（企微会向 URL 发送验证请求）。

## 7. 安装步骤

### 7.1 获取并校验部署包

```bash
# 上传部署包 cs-bot-deploy-<version>.tar.gz 至 /opt，然后：
cd /opt && tar xzf cs-bot-deploy-<version>.tar.gz && mv cs-bot-<version> cs-bot && cd cs-bot
sha256sum -c SHA256SUMS.txt     # 校验镜像 tar 与配置文件完整性，必须全部 OK
```

> 部署包含：镜像 tar 包（或内网 registry 地址）、docker-compose.yml、nginx 配置、config 出厂文件、.env 模板、SHA256SUMS.txt。

### 7.2 导入镜像

```bash
docker load -i images/adapter-<tag>.tar
docker load -i images/fastgpt-<tag>.tar
# 其余基础镜像（nginx/pg/mongo/redis）从公网拉取或使用提供的 tar
docker images | grep -E "adapter|fastgpt"    # 确认 tag 与 compose 文件一致（版本锁定）
```

### 7.3 配置 .env

```bash
cp .env.template .env && chmod 600 .env && vim .env
```

**配置项清单**（★=必填）：

| 变量 | 必填 | 示例 | 说明 |
|---|---|---|---|
| WECHAT_CORP_ID | ★ | ww12ab34cd56ef78 | 企业 ID |
| WECHAT_APP_SECRET | ★ | xxx | 自建应用 Secret |
| WECHAT_AGENT_ID | ★ | 1000002 | 应用 AgentId |
| WECHAT_TOKEN | ★ | xxx | 回调 Token |
| WECHAT_AES_KEY | ★ | xxx（43 位） | 回调 EncodingAESKey |
| WECHAT_CALLBACK_URL | ★ | https://bot.example.com/wecom/callback | 回调地址 |
| FASTGPT_BASE_URL | ★ | http://fastgpt:3001 | 内网地址（默认） |
| FASTGPT_API_KEY | ★ | fastgpt-xxx | FastGPT 应用 Key |
| DEEPSEEK_API_KEY | ★ | sk-xxx | 主 LLM（在 FastGPT 模型配置中同步填） |
| DASHSCOPE_API_KEY | ★ | sk-xxx | 通义 fallback / qwen-vl（增项 A） |
| CONFIDENCE_THRESHOLD | | 0.75 | 置信度阈值（默认 0.75） |
| CONTEXT_ROUNDS / CONTEXT_TTL_SEC | | 5 / 600 | 上下文轮数 / TTL |
| LLM_TIMEOUT_MS | | 15000 | LLM 硬超时 |
| ADMIN_USER / ADMIN_PASSWORD | ★ | admin / 强口令 | 管理接口 Basic Auth |
| ALLOWED_ADMIN_IPS | ★ | 203.0.113.0/24 | 管理接口来源白名单 |
| SLOW_REPLY_TEXT | | （默认话术） | 繁忙提示话术 |
| MISS_RECORD_RETENTION_DAYS | | 90 | 未命中记录保留期 |
| ASSET_MAX_FILE_MB / ASSET_MAX_VIDEO_MB | | 20 / 10 | 素材上限（增项 A） |
| IMPORT_MAX_MSGS / IMPORT_MAX_FILE_MB | | 50000 / 200 | 导入上限（增项 B） |
| MODEL_MODE | | cloud | 模型通道：cloud（基线）/ hybrid（本地优先+云兑底）/ local（全本地）（增项 D） |
| LOCAL_LLM_BASE_URL | | http://vllm:8000/v1 | 本地推理端点（增项 D） |
| LOCAL_EMBEDDING_URL | | http://xinference:9997 | 本地 embedding 端点（增项 D） |
| USAGE_REPORT_ENABLED | | false | 用量上报开关（私有化保持 false） |
| USAGE_WEBHOOK_URL | | - | 用量上报 Webhook 地址（SaaS 形态填，私有化为空） |
| USAGE_REPORT_INTERVAL_MS | | 86400000 | 快照周期（默认 24h，毫秒） |
| USAGE_PERIOD | | daily | 计量周期：daily / weekly / monthly |
| QWEN_VL_BASE_URL | | - | 视觉模型端点（增项 A；为空则走 mock） |
| QWEN_VL_API_KEY | | - | 视觉模型 Key（增项 A） |
| QWEN_VL_MODEL | | qwen-vl-max | 视觉模型名称（增项 A） |
| MAX_ASSET_REFS | | 2 | 单次回复最大引用素材数（增项 A） |
| ASSET_MAX_FILE_MB | | 20 | 素材上限（增项 A） |

### 7.4 放置证书与授权文件

```bash
# TLS 证书
cp /path/to/fullchain.pem nginx/certs/ && cp /path/to/privkey.pem nginx/certs/
chmod 600 nginx/certs/privkey.pem
# 授权证书（交付方签发的 license.lic）
cp /path/license.lic license/ && chmod 600 license/license.lic
```

### 7.5 启动

```bash
docker compose up -d
docker compose ps        # 期望 6 个容器全部 Up / healthy
```

### 7.6 初始化自检

```bash
# 1) 配置自检（密钥存在性，值打码）
curl -s -u admin:<口令> https://<域名>/admin/config-check
# 2) 健康检查
curl -s https://<域名>/healthz          # {"status":"ok"}
# 3) 授权状态
curl -s -u admin:<口令> https://<域名>/admin/license
# 期望：valid=true、剩余天数>0、maxChats 与合同一致
# 4) 用量快照（若启用上报）
curl -s -u admin:<口令> https://<域名>/admin/usage
# 5) 素材列表（增项 A）
curl -s -u admin:<口令> https://<域名>/admin/assets
```

## 8. 部署验证与冒烟测试

| # | 测试项 | 操作 | 期望结果 |
|---|---|---|---|
| 1 | 回调连通 | 企微后台保存回调配置 | 保存成功（无「回调失败」提示） |
| 2 | 触发应答 | 测试群内 @机器人 问一个知识库范围内问题 | ≤8s 收到答案 + 来源引用 |
| 3 | 非触发静默 | 群内发普通聊天（不 @、无关键词） | 机器人 100% 静默 |
| 4 | 拒答兜底 | 问知识库范围外问题 | 收到拒答话术 + miss_record 有记录 |
| 5 | 上下文 | 追问「那运费呢」类指代问题 | 能结合上轮作答 |
| 6 | 未命中导出 | `curl -u admin:... "https://<域名>/admin/miss-records?from=...&to=...&format=xlsx" -o out.xlsx` | 得到 xlsx，行数与库内一致 |
| 7 | 重启恢复 | `docker compose restart && docker compose ps` | 全部恢复，知识库数据不丢 |
| 8 | 密钥检查 | `grep -r "Secret\|sk-" docker-compose.yml nginx/` | 无明文密钥 |
| 9 | 用量端点 | `curl -u admin:... https://<域名>/admin/usage` | 返回 JSON 含 messagesReceived / tokensPrimary 等桶 |
| 10 | 图片识别（增项 A） | 群内发一张产品图并 @机器人 | 返回图片描述文本；识别失败回引导话术且不阻塞文本问答 |

全部通过后进入 UAT（按 PRD AC 清单执行）。

## 9. 日常运维

### 9.1 启停与日志

```bash
cd /opt/cs-bot
docker compose stop / start / restart
docker compose logs -f --tail=200 adapter     # 看适配层日志
docker exec adapter logrotate -f /etc/logrotate.conf   # 手动切割（自动已配置，按天+100M 上限）
```

### 9.2 备份（每日 02:00 自动，保留 7 天）

内容：两个 database 的 pg_dump + mongodump + `data/assets` 打包 → `/opt/cs-bot/backup/`。
验证备份可执行：`docker exec adapter /app/scripts/backup.sh`（手动触发一次，确认产物生成）。

**恢复步骤**（以 PG 为例）：

```bash
docker compose stop adapter fastgpt
gunzip -c backup/pg_adapter_2026xxxx.gz | docker exec -i pg psql -U postgres adapter_db
# FastGPT 库同理；素材目录：tar xzf backup/assets_xxxx.tar.gz -C data/
docker compose start fastgpt adapter
```

### 9.3 升级流程

```bash
cd /opt/cs-bot
docker compose stop adapter                # 1. 停适配层（问答中断，选低峰窗口）
bash scripts/backup.sh                     # 2. 升级前快照（必备，用于回滚）
docker load -i images/adapter-<newtag>.tar # 3. 导入新镜像（其余组件不动）

# 3.1 镜像完整性校验（防篡改）：提取镜像 SHA256，比对交付方提供的指纹
docker images --no-trunc --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep "adapter:<newtag>"
# 输出形如 adapter:v1.2.3 sha256:a1b2c3d4e5f6...，与交付文档中的指纹逐字符核对

sed -i 's/adapter:<oldtag>/adapter:<newtag>/' docker-compose.yml
docker compose up -d adapter               # 4. 启动
curl -s https://<域名>/healthz             # 5. 验证 + 群内冒烟
# 回滚（验证失败时）：反向改回 tag，重新 up -d；必要时用第 2 步快照恢复数据
```

> **镜像校验说明**：交付方在发布镜像时须同时提供 `sha256` 指纹（`docker images --no-trunc` 输出），用户导入后用同样命令提取并逐字符核对。若指纹不一致则存在被植入恶意代码的风险，立即停止部署并联系交付方。

### 9.4 授权续期（到期前 15 天系统每日告警提醒）

```bash
# 1) 导出申请码（或直接沿用原指纹，未换机时无需重新采集）
curl -u admin:<口令> https://<域名>/admin/license        # 记录 fingerprint 字段发给交付方
# 2) 收到新 license.lic 后：
cp new-license.lic /opt/cs-bot/license/license.lic
# 3) 热加载（免重启）：
curl -X POST -u admin:<口令> https://<域名>/admin/license/reload
```

换机迁移：新服务器部署完成后按上述流程重新采集指纹 → 换发证书（交付方不收取开发费）。

## 10. 常见故障排查

| 现象 | 可能原因 | 处置 |
|---|---|---|
| 企微后台保存回调提示失败 | ① 域名/DNS/证书问题 ② 443 未放行 ③ Token/AESKey 填错 | `curl -v https://<域名>/healthz`；核对 .env 四项；看 `docker compose logs adapter` 是否收到验证请求 |
| 群里 @机器人 无任何反应 | ① 应用未加入该群 ② 触发词不匹配 ③ 授权受限模式 | 查 `/admin/license` 是否 valid；核对 keywords.yml；确认应用在群内 |
| 机器人回复「系统繁忙」 | LLM 双通道失败/超时 | 查 DeepSeek 账户余额；`config-check` 验证 Key；看出站防火墙是否放行两个 LLM 域名 |
| 容器反复重启 | ① .env 缺必填项（fail-fast） ② license 缺失/验签失败 | `docker compose logs adapter | head -50`，按日志提示补齐配置或证书 |
| 回复内容被替换为安全话术 | 命中敏感词库 | 属预期行为；查审计日志确认命中词，必要时精简词库 |
| 图片识别一直失败（增项 A） | qwen-vl 超时/配额 | 查 dashscope 出站与配额；识别失败会自动回引导话术，不影响文本问答 |
| 用量端点空/缺桶 | 上报未启用或周期未到 | 确认 `USAGE_REPORT_ENABLED`；`USAGE_PERIOD=daily` 需等当日快照 |
| 导入任务长时间无进度（增项 B） | 内存水位 >80% 自动暂挂 | 等待低峰自动续跑；`GET /admin/import/jobs/:id` 看进度与统计 |
| 磁盘告警 | 备份/日志堆积 | 清理 `backup/`（保留 7 天自动）；确认日志轮转生效 |
| Redis OOM 重启 | maxmemory 到顶 | 默认 384M + allkeys-lru 自动驱逐；持续告警则考虑升配 |
| 系统时间改动后机器人只回授权提示 | 时间回拨防护触发 | 把时间校正为真实时间后 `POST /admin/license/reload` |

**联系支持**：质保期内缺陷远程支持；提供 `docker compose ps`、`logs --tail 500` 输出与问题时间点。

## 11. 安全基线自查清单（上线前逐项确认）

- [ ] `.env` 权限 600、属主为运行用户；未提交到任何代码仓
- [ ] 服务器仅 443（公网）+ 22（白名单）开放；5432/27017/6379 未映射宿主机
- [ ] 出站白名单生效（仅企微/DeepSeek/通义域名）
- [ ] TLS 证书有效且自动续期已配置（DV 证书 90 天到期）
- [ ] 管理接口 Basic Auth + IP 白名单（`ALLOWED_ADMIN_IPS`）
- [ ] FastGPT 后台已改强口令并限源访问
- [ ] `license/` 目录权限 600
- [ ] 交付镜像导入后 SHA256 指纹与交付文档一致（9.3 步骤 3.1，防镜像被替换）
- [ ] 交付镜像已启用 JS 全量混淆（交付方构建期确认：Dockerfile 中 `obfuscate` 步骤未被跳过）
- [ ] 备份任务已验证可执行、产物可恢复
- [ ] SSH 密钥登录、禁用密码登录
- [ ] 群公告已按隐私告知模板说明机器人处理规则（PRD 合规要求）

## 附录 A：SaaS 形态租户开通（形态 B）

客户侧无需自建任何服务器，开通流程：

1. 联系交付方平台运营，提供：企业名称、联系人、订阅档位（标准/增强）、企微 CorpID。
2. 平台 30 分钟内完成租户实例开通（独立数据库/独立域名/独立证书），返回：租户域名、管理员初始口令（一次性展示）。
3. 客户在租户管理页填入企微 Secret/Token/AESKey 与 LLM 配置（或使用平台代付额度）。
4. 企微后台把回调 URL 配置为 `https://<租户域名>/wecom/callback`，保存校验通过即完成。
5. 日常：知识运营在租户专属 FastGPT 后台维护知识库；升级由平台统一执行（提前 3 个工作日通知）。
6. 订阅到期：前 30/15/7 天提醒 → 7 天宽限期（问答可用、不可改知识/加群）→ 宽限期满仅提示续期；续费即时恢复。
7. 数据可随时申请导出；注销时走「导出确认 → 7 天后删除（含备份）→ 删除确认单」流程。

## 附录 B：.env 最小可用模板

```dotenv
# ---- 企微（必填）----
WECHAT_CORP_ID=
WECHAT_APP_SECRET=
WECHAT_AGENT_ID=
WECHAT_TOKEN=
WECHAT_AES_KEY=
WECHAT_CALLBACK_URL=https://bot.example.com/wecom/callback
# ---- FastGPT / LLM（必填）----
FASTGPT_BASE_URL=http://fastgpt:3001
FASTGPT_API_KEY=
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
# ---- 管理接口（必填）----
ADMIN_USER=admin
ADMIN_PASSWORD=
ALLOWED_ADMIN_IPS=192.168.1.0/24
# ---- 业务参数（默认即可）----
CONFIDENCE_THRESHOLD=0.75
CONTEXT_ROUNDS=5
CONTEXT_TTL_SEC=600
LLM_TIMEOUT_MS=15000
MISS_RECORD_RETENTION_DAYS=90
USAGE_REPORT_ENABLED=false
# ---- 用量上报（SaaS 形态填；私有化留空）----
USAGE_WEBHOOK_URL=
USAGE_REPORT_INTERVAL_MS=86400000
USAGE_PERIOD=daily
# ---- 增项 A：多媒体识别与素材管理（留空走 mock）----
QWEN_VL_BASE_URL=
QWEN_VL_API_KEY=
QWEN_VL_MODEL=qwen-vl-max
MAX_ASSET_REFS=2
```

## 附录 D：本地模型部署与切换（增项包 D）

适用：数据不出域要求的客户。模型通道三档：`cloud`（基线，云 API）/ `hybrid`（本地优先，超时/故障自动切云）/ `local`（全本地，故障回繁忙话术不出域）。

**D.1 硬件选型（客户自备 GPU 服务器）**

| 档位 | 硬件 | 可跑模型 | 预期性能 |
|---|---|---|---|
| 入门 | T4 16G / 8C16G | Qwen2.5-7B int4 | 20–30 tok/s，并发 ~4 路 |
| 推荐 | A10/L4 24G / 8C16G | Qwen2.5-7B fp16 或 14B int4 | 40–60 tok/s，并发 ~10 路 |
| 兑底 | 无 GPU，8C32G CPU | Qwen2.5-7B int4（Ollama） | 5–10 tok/s，仅日活 <500 |

**D.2 部署步骤**

```bash
# 1) 拉起推理与 embedding 服务（部署包含 local-models-compose.yml）
docker compose -f local-models-compose.yml up -d     # vllm + xinference
# 2) 拉模型（首次 ~15G 下载）
docker exec vllm vllm serve Qwen/Qwen2.5-7B-Instruct --max-model-len 8192
docker exec xinference xinference launch --model bge-m3
# 3) FastGPT 后台配置渠道：
#    新增模型渠道 → 地址 http://vllm:8000/v1 → 模型 Qwen2.5-7B-Instruct
#    embedding 渠道 → 地址 http://xinference:9997 → 模型 bge-m3
# 4) 切换通道（改 .env 后重载）
sed -i 's/MODEL_MODE=cloud/MODEL_MODE=hybrid/' .env && docker compose restart adapter
```

**D.3 重要注意事项**

- **embedding 切换必须全量重建向量索引**：云/本地 embedding 向量空间不兼容；在 FastGPT 后台对全部知识库发起重新向量化（5 千 QA 约 0.5–2 小时，选业务低峰）。LLM 通道切换无此限制，可热切。
- 本地档时延预期：P95 ≤15s（低于云档 8s，属数据不出域的预期取舍）；`LLM_TIMEOUT_MS` 建议调到 20000–30000。
- 出站防火墙：`local` 模式可完全关闭 LLM 云端出站（仅保留企微域名）。
- GPU 驱动 + NVIDIA Container Toolkit 需提前安装（不在部署包内）。

## 附录 E：命令速查

| 操作 | 命令 |
|---|---|
| 启动 / 停止 | `docker compose up -d` / `docker compose stop` |
| 状态 | `docker compose ps` |
| 日志 | `docker compose logs -f --tail=200 adapter` |
| 健康检查 | `curl -s https://<域名>/healthz` |
| 配置自检 | `curl -u admin:*** https://<域名>/admin/config-check` |
| 授权状态 | `curl -u admin:*** https://<域名>/admin/license` |
| 授权热加载 | `curl -X POST -u admin:*** https://<域名>/admin/license/reload` |
| 用量快照 | `curl -s -u admin:*** https://<域名>/admin/usage` |
| 素材列表（增项 A） | `curl -s -u admin:*** https://<域名>/admin/assets` |
| 素材上传（增项 A） | `curl -s -u admin:*** -F "file=@xxx.jpg" https://<域名>/admin/assets` |
| 手动备份 | `docker exec adapter /app/scripts/backup.sh` |
| 进数据库 | `docker exec -it pg psql -U postgres -d adapter_db` |

---

*版本记录：V1.0（2026-10-12）初版，随《概要设计》V1.7 一并发布；V1.1（2026-10-12）随概设 V1.8 新增本地模型附录 D 与 MODEL_MODE 配置。覆盖形态 A 全流程、形态 B 租户开通、本地模型档部署。*
