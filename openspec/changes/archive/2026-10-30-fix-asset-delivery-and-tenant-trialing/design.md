# Design

## Context

素材外发链路：`QaOrchestrator` 解析 `[[素材:<uuid>]]` → `AssetReferenceResolver` 查 `asset` 行 → `AssetSenderService` → `IMessageSender.sendAsset`（由 `WecomClient` 实现，R-1 唯一企微出口）。

当前断点：

1. 编排器只把 `{ id, type }` 传下去，`url`/`name` 丢失；
2. `asset.url` 是 `/assets/<id>.<ext>` 的对外相对路径，不是文件系统路径；
3. `sendAsset` 对 link 只发 URL，标题缺失；
4. 失败被 `AssetSenderService` 吞掉，编排器无法补发降级话术；
5. `AssetService.delete` 只清理 `file` 类型的落盘文件。

## Goals / Non-Goals

**Goals**

- file/video/link 三类素材在真实企微群可用（发得出去、失败可见）。
- 删除素材不遗留落盘文件。
- `trialing` 租户状态可持久化，与状态机/规格一致。

**Non-Goals**

- 不改对外接口路径与入参；不新增素材类型。
- 不引入素材发送重试队列（规格明确"不重试"）。

## Decisions

### D1 沿用一个端口，扩展 `IMessageSender.sendAsset` 的可选 `title`

`sendAsset(chatId, target, type, title?)`：

- `link`：`target` 为 URL，`title` 为素材名 → M1 发 `标题\nURL`；
- `file`/`video`：`target` 为绝对文件路径，`title` 透传为企微 `title`/`description`。

理由：保持"单一企微出口"（R-1），不新增跨模块调用；`title` 可选，兼容既有调用与测试。

### D2 路径解析放在 `AssetSenderService`

`/assets/<name>` → `join(process.cwd(), 'data', 'assets', basename(<name>))`；已经是绝对路径且存在的直接使用。用 `basename` 阻断 `..` 逃逸。理由：解析属"外发前准备"，编排器不应知道存储布局；`AssetService.resolvePath` 不使用（它不带扩展名且会误导）。

### D3 失败提示由编排器统一发一次

`AssetSenderService.send` 改为返回 `boolean`（仍然只记 WARN 不抛），编排器收集失败标记，循环结束后若存在失败则 `sendText(ASSET_FAIL_TEXT)` 一次。理由：提示是"整条答复"级别，且必须经 M6 之外的固定话术路径（R-3 豁免系统固定话术）。

### D4 `trialing` 通过追加迁移放宽 CHECK

新增 `platform/018-tenant-trialing.sql`：`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT`，值集合在 015 基础上加 `trialing`。不改写 007/015（追加式迁移约定）。

## Risks / Trade-offs

- 放宽 CHECK 只增不减，存量数据不受影响；回滚需手工恢复约束（记录在迁移注释）。
- link 外发文本由"纯 URL"变为"标题 + URL"：属于展示优化，群成员仍可直接点开链接。
- 素材失败提示只发一次，多个失败不逐个播报，避免刷屏。

## Migration Plan

1. 代码与迁移随镜像发布；`018` 由既有迁移执行路径（initdb 挂载 / `/app/migrate/*.sql`）自动执行，幂等。
2. 存量已删除 video 素材的孤儿文件不自动清理，由运维在维护窗口按 `asset` 表比对 `data/assets/` 清理（写入部署手册排障章节的既有清理建议，不新增脚本）。

## Open Questions

（无）
