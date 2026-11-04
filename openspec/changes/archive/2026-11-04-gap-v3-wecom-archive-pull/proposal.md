## Why

现有仅 `POST /admin/archive/ingest` 手工推送；概设要求的企微会话存档 SDK/回调拉取未接，无法自动进入 import。

## What Changes

- 新增存档拉取客户端（与群消息 `WecomClient` 分离的存档 IO）
- 定时/手动 pull + 可选回调；规范化后走现有 `ImportJobService.createFromFile` / enqueue
- 单租户 cursor、幂等 msgId/source hash、R-8 背压可暂挂
- admin-web `/archive` 页：任务列表、pull 状态、触发补拉

## Capabilities

### New Capabilities

- `wecom-session-archive`: 存档凭证、拉取、回调验签、cursor、与群回调隔离

### Modified Capabilities

- `import-pipeline`: Session archive ingest 扩展为 push+pull 同源入队
- `admin-console`: Archive 运营页

## Impact

- 代码：`wecom/` 存档客户端、`archive/` 调度、admin API、admin-web
- 非目标：同步全量 parse 占问答热路径；直连 FastGPT Mongo
