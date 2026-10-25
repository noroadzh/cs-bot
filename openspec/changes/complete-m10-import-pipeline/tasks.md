# Tasks

## 1. Schema 与配置

- [x] 1.1 写追加式迁移 `apps/adapter/src/import/007-import-pipeline.sql`：`import_job` 增阶段计数（cleaned/paired/unpaired）与 `dataset_name`；`import_item` 增 `imported_qa_id`、`auto_blocked`、`similar_qa_id`；新增 `import_unpaired` 表；索引；幂等 DDL
- [x] 1.2 新增 `config/import-rules.yml`（清洗规则）与 `config/import-blacklist.txt`（黑名单）样例，进 `config.schema.ts` 路径配置
- [x] 1.3 流式解析改造：xlsx 用 exceljs stream、csv/txt 逐行、企微存档 JSON 流式；spec 校验峰值内存 < 200MB（大文件样本）

## 2. 清洗与配对

- [x] 2.1 实现 `ImportCleaner`（系统/占位/机器人自身/60s 刷屏/短消息规则，规则文件热加载），spec 覆盖每条规则与开关
- [x] 2.2 实现 `QaPairing`（30min 窗口、客户聚合为问、客服首条实质回复为答、多轮合并、单边入池），spec 覆盖配对/合并/单边
- [x] 2.3 实现内容嗅探（企微存档 JSON / 三列表头 / 直接成对），未识别 → 415；`ImportJobService.parseJob` 按 shape 分流

## 3. 黑名单与近似去重

- [x] 3.1 实现黑名单 screening（`auto_blocked=true`，不可批量通过，与 M6 独立），spec 覆盖命中与隔离
- [x] 3.2 实现近似去重（FastGPT retrieval top1，score ≥ 0.9 记 `similar_qa_id`，失败不阻塞），spec 覆盖命中/未命中/检索失败

## 4. 审核清单与提交/回滚

- [x] 4.1 实现 `review.xlsx` 生成（脱敏列、30 天保留），`GET /admin/import-jobs/:id/review.xlsx`
- [x] 4.2 实现 `POST /admin/import-jobs/:id/confirm`（提交审核结果，仅 approved 且非 auto_blocked 入库）
- [x] 4.3 实现 `POST /admin/import-jobs/:id/rollback`（删数据集 collection/标签 + 刷新缓存，不重启）与 `POST .../retry`（仅失败项，`source_hash` 幂等）
- [x] 4.4 实现清理策略：任务结束删 `data/import/{jobId}/source.*`；`review.xlsx` 30 天定时清理

## 5. FastGPT 数据集 client

- [x] 5.1 实现 `FastGPTDatasetClient`（建/批量写/删 collection/按 tag 删），每批 50、退避 3 次、失败单列
- [x] 5.2 集成到 confirm/rollback/retry，断言 approved 后可在 `历史语料-{jobId}` 检索、回滚后不可检索

## 6. 端点与集成

- [x] 6.1 `import.module.ts` 注册新 provider；`import-job.entity.ts` 增阶段计数/新字段类型；job detail 暴露阶段计数
- [x] 6.2 既有全套 jest 通过；新增 spec 覆盖清洗/配对/黑名单/去重/清单/回滚/retry

## 7. 端到端验证

- [x] 7.1 真实 PG + mock FastGPT dataset client 跑通：上传企微存档 → 清洗 → 配对 → 审核清单 → confirm → 数据集写入 → rollback → verify
- [x] 7.2 `openspec validate complete-m10-import-pipeline --strict` 通过
