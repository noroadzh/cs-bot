# 概要/详细设计完整性复核（2026-10-28，只读）

## 范围

M1–M11 全模块，对照《概要设计 V1.9》《详细设计 V1.1》与本轮已完成变更后的实现。结论按“是否影响功能完整/合规/可用性”排序。

## 结论

核心消息链路（M1–M9）与导入（M10）主流程已完整；**尚未“全部完成”**，剩余缺口集中在 M10 合规细节、M11 注销导出/续期/控制面运维，以及 M8 图片异步。

## P0（合规/数据）

1. **租户导出包内容不完整**：`platform.module.ts:109-127` 仅打包 `knowledgeBase: ''`、资产文件名列表、租户配置 JSON；未包含知识库文档、assets 文件内容、`pg_dump`。设计 M11 Offboarding 要求“知识库文档 + assets + pg_dump + config 加密交付”。
   建议：导出时执行租户 PG dump、复制 assets、导出 FastGPT 数据集文档，再统一加密。

## P1（功能/安全/可用性）

2. **续期未重新签发 license**：`tenant.service.ts:317-377` 只更新 `expired_at`/状态并 sync；`licenseIssuer.issue` 仅在 provision（:234）调用。租户实例原 license 到期后进入受限模式，续费不能热生效。
3. **控制面 3100 默认公网发布**：`deploy/docker-compose.yml:64` `${CONTROL_PLANE_BIND:-0.0.0.0}:3100:3100`；设计 M11 要求控制面仅管理网段访问、无公网管理口。
4. **图片识别未异步**：`wecom.controller.ts:184-221` 在回调 ack 前 `await downloadMedia + recognizeImage`，识别最长 15s，企微 5s 无 ack 会重试；设计 M8 要求图片识别全程异步走主动发送。
5. **图片识别提示词/模型/超时与设计不符**：`media-recognize.service.ts:37,80` 使用 `LLM_TIMEOUT_MS`（15s）与 `qwen-vl-plus` 硬编码，提示词是“描述图片主要内容”而非“提取咨询相关文字归纳为一句问题/无内容返回 [NO_TEXT]”；`QWEN_VL_MODEL` 配置未使用。
6. **导入源文件权限非 0600**：`import-create.ts:204` `fs.writeFile(target, bytes)` 未传 mode；设计 M10 要求源文件 0600。
7. **M10 PII 脱敏缺地址/姓名**：`sensitive-redactor.ts` 仅 PHONE/ID/CARD/EMAIL/URL；设计 M10 步骤 5 明确包含“详细地址、姓名模式”。（OpenSpec import-review 规格只列 5 类，属规格与设计漂移。）
8. **数据集写入无 3 次指数退避**：`fastgpt-dataset.client.ts:50-60` 单次 POST；设计 M10 步骤 8 要求每批失败重试 3 次。
9. **重启后回滚无法定位数据集**：`fastgpt-dataset.client.ts:69-75` 依赖内存 `nameToId`，服务重启后 rollback 找不到 datasetId，无法删除。
10. **控制面库未纳入每日备份**：`deploy/backup.sh` 只 dump adapter/fastgpt DB、mongo、assets、租户实例；未 dump `csbot_control`，设计 M11 要求控制面每日备份。
11. **平台生成管理员口令无一次性展示**：`tenant-secrets.service.ts:78-89` 生成 `ADMIN_PASSWORD`/`FASTGPT_ROOT_PASSWORD` 后只写加密文件，控制器无返回值/查询接口；设计 M11 要求“随机生成、一次性展示”。
12. **未配对消息无法人工补配**：`import_unpaired` 只写不读，无列表/补配接口；设计 M10 步骤 4 要求“可在清单中人工补配”。
13. **导入解析仍同步占 HTTP 请求**：`import.controller.ts:161` → `parseJob` 在请求内完成；设计 M10 要求后台异步任务/进程内队列，200MB 文件会长时间占用请求。

## P2（体验/契约/运维）

14. M6 敏感词命中是替换词为 `[内容已过滤]`（`sensitive-filter.service.ts:60-72`），设计要求整段替换为固定话术“抱歉，该内容不便回复…”。
15. M3 `CONTEXT_ROUNDS` 配置未使用，`context.service.ts` 固定保留 10 条消息（5 轮）。
16. M5 未命中导出只支持 `days`，设计接口为 `from=&to=`（`miss.controller.ts:20-40`）。
17. M2 未实现 `triggers.prefixes` 前缀配置，仅关键词子串匹配（`trigger.service.ts:31-35`）。
18. M4 拒答话术默认值与设计文案不同（`config.schema.ts:48`）。
19. M9 触达群上限拒绝新群后仅日志，无告警（`licensed-chat.service.ts:54-75`）。
20. M11 配额维度缺 `max_docs/max_qa/max_asset_mb`（`007-tenant.sql:25-29`），用量日报缺 doc/qa/asset 字段（`:38-49`）。
21. M11 到期提醒只有 webhook，无邮件通道；升级无 02:00–04:00 窗口与提前 3 天通知（`subscription-reminder.ts`、`upgrade-orchestrator.ts`）。
22. M11 审计无 `reason` 必填、无 `shell_access` 动作、无异地留存（`platform-audit.service.ts`、`tenant.entity.ts:68-83`）。
23. M11 日消息配额 100% 时 `tenant-gate.service.ts:80-83` 拒绝所有消息，设计说“已服务群不受影响/限流”。
24. M10 内存保护阈值按 `IMPORT_MEMORY_LIMIT_MB*0.8`（默认 410MB），设计目标峰值 <200MB。
25. M8 控制器固定 `image/jpeg` 传给识别器（`wecom.controller.ts:193`），PNG/WebP 可能走错分支。
26. hybrid 模式 30s 健康探测 + 5 分钟滞回未实现（概设 §M4）；`local-model-routing` 规格仍描述已被 FastGPT RAG 取代的直连本地 LLM 路径。
27. M10 失败任务未删除源文件：`failJob` 只改状态，未调用 cleanupSource（设计要求任务结束含失败立即删除）。

## 已接受/非缺口

- 群聊 appchat 不支持被动回复，仅主动发送（平台限制，代码已注释）。
- 管理 UI、mTLS、控制面独立目录 `apps/control-plane`、导入路径 `admin/import-jobs`：此前已决策保留现状。
- 5.4 真实多租户 UAT 受环境限制延后。

## 建议

按 P0 → P1 拆分 OpenSpec 变更：先补租户导出与续期 license，再处理控制面端口/备份、图片异步、导入 PII/文件权限/重试，P2 归入后续体验与运维批次。
