# Design: complete-m10-import-pipeline

## Context

M10 已交付「上传→解析→脱敏→审核→本地语料」主干；本 change 补齐概设 §5 M10 的清洗、会话切分与 QA 配对、敏感黑名单、近似去重、审核清单与批次回滚、FastGPT 独立数据集入库。现有 `ImportJobService`（raw pg + `SensitiveRedactor` + `ImportParser`）作为基线复用。

## Goals / Non-Goals

**Goals:**
- 真实历史会话（企微存档/三列表）可合规导入，峰值内存 < 200MB。
- 审核清单可下载、可提交、可回滚；approved 条目进 FastGPT 独立数据集。
- 不破坏现有直接成对格式（csv question,answer / Q:A / json array）的行为。

**Non-Goals:**
- 不做多任务并行导入（保持单任务并发）。
- 不做跨批次全局去重（仅批次内 + 近似已有）。
- 不改出站 M6 过滤。

## Decisions

### D1: 清洗规则外置为 `config/import-rules.yml`
系统消息/占位消息/机器人自身/60s 刷屏/短消息规则逐项开关与参数（如 `minEffectiveChars: 4`、`repeatWindowSec: 60`），`fs.watch` 热加载（与 M6 词库同模式）。

### D2: 会话切分与 QA 配对
按 `(conversationId, customerId)` 分组；窗口 gap > 30min 切分。窗口内客户侧连续消息拼接为问，其后客服侧首条「长度 ≥ 6、非纯表情/感谢」为答；同话题多轮合并（问取首条、答取末条）。单边入 `import_unpaired` 池。算法为纯函数，单测覆盖。

### D3: 黑名单独立于出站词库
`config/import-blacklist.txt` 只做入库准入；命中 `auto_blocked=true`，不进「建议保留」集、不可批量通过。

### D4: 近似去重走 FastGPT 检索
以「问」调 FastGPT retrieval top1，score ≥ 0.9 记 `similar_qa_id` 并默认建议丢弃；检索失败不阻塞，仅置 `similar_qa_id=null`。

### D5: 审核清单 + 提交 + 回滚
`review.xlsx` 由 exceljs 生成（脱敏后，30 天保留）；`confirm` 接受审核结果，仅 approved 且非 auto_blocked 写入数据集；`rollback` 删 `历史语料-{jobId}` collection（或按 `batch_id` 标签批量删除）+ 刷新检索缓存。

### D6: FastGPT dataset client
新增出站 client（`FastGPTDatasetClient`），封装「建 collection / 批量写 / 删 collection / 按 tag 删」，每批 50、指数退避 3 次；失败条目单列，`retry` 仅重试失败项，按 `source_hash` 幂等跳过已入库。

### D7: 流式解析与内存控制
xlsx 用 exceljs 流式逐行；csv/txt 流式；企微 JSON 按 message 数组流式读取。逐条处理即释放，峰值 < 200MB（对齐 adapter 512M 限额）。

### D8: 清理策略
任务结束（含失败）立即删 `data/import/{jobId}/source.*`；`review.xlsx` 保留 30 天，由定时任务清理；discard 条目正文不落库（仅 `source_hash` + 状态）。

## Risks / Trade-offs

- [R1 流式解析内存] → exceljs stream + 逐行释放；压测校验峰值。
- [R2 FastGPT 数据集能力差异] → 若版本不支持独立 collection，退化统一 collection + `batch_id` 标签（实施时确认）。
- [R3 近似去重耗时] → 逐条检索可能慢；批量导入时异步、可跳过（配置开关）。
- [R4 回滚一致性] → 回滚删 collection 为尽力而为；失败记录 `last_error` 可重试。
- [R5 与现有直接成对格式兼容] → 嗅探分流：conversation shape 走清洗+配对，其余保持原路径。

## Migration Plan

1. **Schema**: `import_job` 增阶段计数与 `dataset_name`；`import_item` 增 `imported_qa_id`/`auto_blocked`/`similar_qa_id`；新增 `import_unpaired`（或 item 状态标记）。追加式迁移 `import/007-import-pipeline.sql`。
2. **配置**: 新增 `config/import-rules.yml`、`config/import-blacklist.txt` 样例。
3. **代码**: 清洗/配对/黑名单/去重/清单/dataset client + 端点。
4. **回滚**: 关闭新端点（feature flag）或保留旧直接成对路径；DB 迁移不回退。

## Open Questions

- FastGPT 版本是否支持独立 dataset collection？退化为 batch tag 的验收口径。
- `review.xlsx` 提交格式（回传清单 vs JSON）以运营习惯为准。
