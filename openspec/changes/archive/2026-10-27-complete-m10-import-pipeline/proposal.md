# Proposal: complete-m10-import-pipeline

## Why

M10（增项 B）当前实现覆盖「上传 → 解析 → 脱敏 → 逐条/批量审核 → approved 进本地语料」主干，但概设 §5 M10 要求的 8 步管线中，清洗、会话切分与 QA 配对、敏感剔除黑名单、近似去重、审核清单文件、批次回滚、FastGPT 独立数据集入库均未实现。运营方导入真实历史会话（企微存档/客服表格）时仍无法得到合规、可回滚的语料。

## What Changes

- **上传内容嗅探**：识别企微存档 JSON 结构与「时间/说话方/内容」三列式表头；`IMPORT_MAX_FILE_BYTES` 对齐概设 200MB。
- **清洗**：`config/import-rules.yml` 规则——剔除系统消息、占位消息（图片/语音/视频/文件/表情）、机器人自身消息、60s 刷屏重复、有效字符 < 4 的短消息。
- **会话切分与 QA 配对**：按（会话+客户）分组、30 分钟窗口切分；客户侧连续消息聚合为「问」，客服侧首条实质回复为「答」；同话题多轮合并；单边消息入未配对池。
- **敏感剔除黑名单**：`config/import-blacklist.txt`（与 M6 出站词库独立），命中置 `auto_blocked=true`、不可批量通过。
- **近似去重**：调 FastGPT 检索 top1，score ≥ 0.9 标记 `similar_qa_id`，默认建议丢弃。
- **审核清单与提交**：生成 `review.xlsx`（脱敏后，30 天有效），`POST /admin/import-jobs/:id/confirm`（提交审核结果触发批量入库）、`/rollback`（批次下线）、`/retry`（失败条目重试）。
- **FastGPT 数据集入库**：仅审核通过条目写入独立数据集 `历史语料-{jobId}`（每批 50、退避重试 3 次），回写 `import_item.imported_qa_id`；批次回滚 = 删 collection。
- **清理策略**：任务结束删 `data/import/{jobId}/source.*`；`review.xlsx` 30 天由定时任务清理。

## Capabilities

### New Capabilities
- `import-pipeline`: 清洗规则、会话切分与 QA 配对、敏感黑名单、近似去重、审核清单生成与批次回滚。

### Modified Capabilities
- `import-job`: 增加内容嗅探、清洗/配对阶段计数与状态、`review.xlsx`/`confirm`/`rollback`/`retry` 端点。
- `import-review`: approved 条目写入 FastGPT 独立数据集（保留本地 `approved_qa` 作为降级/检索缓存）。

## Impact

- **代码**：`apps/adapter/src/import/`（parsers 扩充、cleaning/pairing/blacklist、review-xlsx、dataset client）、`apps/adapter/src/config/config.schema.ts`（文件上限）。
- **API**：新增 `GET .../:id/review.xlsx`、`POST .../:id/confirm|rollback|retry`；现有端点语义保持兼容。
- **SQL**：`import_job` 增加阶段计数（cleaned/paired/unpaired）与 `dataset_name`；`import_item` 增加 `imported_qa_id`、`auto_blocked`、`similar_qa_id`。
- **依赖**：exceljs（已有）、FastGPT 数据集 API（新增出站 client）、`js-yaml`（已有）。
- **风险**：流式解析内存控制（峰值 < 200MB）；FastGPT 数据集能力需按版本确认。

## 备注

- 概设 §5 M10、详设 §3.9；总纲见 `close-overview-design-gaps`。
- 本 change 只做 M10 重管线，不含 M11/增项 D/验收测试。
