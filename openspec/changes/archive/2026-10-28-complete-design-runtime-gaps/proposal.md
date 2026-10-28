# Proposal

## Why

2026-10-28 的完整性复核（`openspec/explorations/2026-10-28-design-completeness-recheck.md`）显示：核心问答链路已完整，但租户注销导出、续期授权、控制面运维、导入合规与图片链路仍有 1 项 P0、13 项 P1、14 项 P2 缺口。部分缺口直接触及合规（导出包不含知识库/pg_dump、PII 地址姓名未脱敏）与可用性（续期后 license 仍过期、图片识别占用回调 ack）。

## What Changes

### P0 合规

- **租户导出包补全**：export 生成真实的知识库文档、assets 文件、租户 `pg_dump` 与配置，再统一加密；不再打包空知识库与文件名列表。

### P1 功能/安全/可用性

- **续期重签授权**：renew 在更新订阅期后重新签发绑定实例指纹的 license，并同步/热加载到租户实例。
- **控制面暴露收敛**：compose 中控制面默认不发布公网端口；需要远程访问时显式绑定管理网段。
- **控制面库备份**：每日备份增加 `csbot_control` 的 pg_dump。
- **图片链路异步化**：回调先 ack，再异步下载/识别/发送；识别提示词改为“提取咨询相关文字归纳为一句问题，无内容返回 `[NO_TEXT]`”，超时 10s，使用 `QWEN_VL_MODEL` 与真实 MIME。
- **导入合规**：源文件 0600；脱敏增加详细地址与姓名两类占位符；数据集写入 3 次指数退避；rollback 在进程重启后仍能按持久化 dataset 标识删除；失败任务立即删除源文件。
- **异步导入任务**：解析不再占用 HTTP 请求，改为进程内后台执行，接口返回任务状态由轮询获取。
- **凭证交接**：开通后一次性展示生成的管理员/FastGPT 根口令，之后不可再次读取，且不得写日志。
- **未配对消息补配**：提供未配对池查询与人工配对接口，补配后进入审核清单。
- **敏感词策略**：命中后整段替换为固定话术，而不是只替换命中词。
- **上下文轮数可配**：`CONTEXT_ROUNDS` 生效（默认 5 轮）。
- **未命中导出契约**：支持 `from`/`to` 日期范围（保留 `days` 兼容）。
- **控制面配额与审计**：补齐文档数/QA 对数/素材容量配额与用量快照；审计记录必填原因、增加 `shell_access` 动作。
- **升级窗口与提醒**：升级默认窗口 02:00–04:00，提前 3 个工作日通知。
- **租户群上限告警**：拒绝新群时向运维通道告警。
- **local-model-routing 收敛**：规格改为当前 FastGPT RAG 架构；hybrid 增加 30s 健康探测与 5 分钟滞回。

### P2 体验/契约

- 拒答文案、前缀触发、日配额 100% 行为、导入内存预算等按复核记录逐项收口；不改变已冻结的对外路径。

### 暂不纳入

- 群聊被动回复（平台不支持 appchat 被动回包）、管理 UI、mTLS、控制面独立目录 `apps/control-plane`、导入路径 `admin/import-jobs`。
- 5.4 真实多租户 UAT（环境受限，另行安排）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `tenant-registry`：续期重签 license；导出包内容补全；到期提醒通道。
- `deployment-suite`：控制面不公网发布；控制面库备份。
- `media-recognition`：图片异步、提示词/超时/模型/MIME。
- `import-job`：源文件 0600；后台异步解析。
- `import-pipeline`：未配对补配、rollback 持久化、失败清理、内存预算。
- `import-review`：地址/姓名脱敏与占位符类型。
- `tenant-provisioning`：凭证一次性交接。
- `sensitive-filter`：整段固定话术。
- `session-context`：`CONTEXT_ROUNDS` 可配。
- `tenant-quota`：文档/QA/素材配额维度；配额超限行为澄清。
- `usage-reporting`：容量用量快照。
- `platform-audit`：reason 必填、`shell_access` 动作、留存说明。
- `tenant-upgrade`：升级窗口与提前通知。
- `license-skeleton`：群上限拒绝告警。
- `local-model-routing`：FastGPT RAG 架构对齐 + hybrid 健康探测滞回。

## Impact

- **代码**：`platform/*`（offboarding export、renew、backup、audit、quota、upgrade、license alert）、`import/*`（create/parse/confirm/dedupe/review/manifest、dataset client）、`media/*`、`wecom/controller`、`filter/*`、`context/*`、`admin/miss`、`config.schema`、`deploy/*`。
- **数据**：`import_job.dataset_id`/`unpaired review` 状态、`tenant_quota` 新维度、`tenant_usage_daily` 容量字段、审计 reason。
- **API**：新增未配对查询/补配、凭证一次性查看；`miss-records` 支持 from/to；其余路径不变。
- **运维**：控制面端口绑定、备份脚本、升级窗口/通知。
- **文档**：设计文档中待收敛的 hybrid/配额/提醒描述随实现同步。
