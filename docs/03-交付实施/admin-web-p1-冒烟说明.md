# admin-web P1 冒烟说明（学习 / 看板 / 知识）

本地或联调环境确认下列路径（需 Basic Auth）：

1. **看板** `/dashboard`：打开后应请求 `GET /admin/stats/overview?period=daily`，展示消息量/命中率与 TOP 未命中。
2. **学习** `/learning`：点「聚类近期未命中」→ 审核队列出现建议答案；「审核入库」走 `POST /admin/learning/approve`；下方审计列表可读。
3. **知识库** `/knowledge`：列表走 `GET /admin/knowledge/collections`；「一键补录」走 `POST /admin/knowledge/ingest` 后集合计数刷新。

自动化：`pnpm -C apps/admin-web test`（含 Dashboard / Knowledge / Learning 页用例）。
