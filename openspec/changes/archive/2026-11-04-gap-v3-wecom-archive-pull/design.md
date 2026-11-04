## Context

仅有 admin ingest；缺 SDK/回调与 cursor。

## Goals / Non-Goals

**Goals:** 拉取/回调 → 同构入队；`/archive` 页。  
**Non-Goals:** 与 `WecomClient` 群发混用；同步全量 parse。

## Decisions

1. `WecomSessionArchiveClient` 独立文件/注入。
2. `ArchivePullScheduler` 单 flight；cursor 落 PG/Redis。
3. 实现可先 HTTP/Command sidecar，OpenSpec 锁消息契约。

## Risks / Trade-offs

- SDK 绑定形态不确定 → 接口契约优先。
- 背压 → 复用 import 暂挂。

## Migration Plan

`WECOM_ARCHIVE_ENABLED` 默认 false；开启才调度。
