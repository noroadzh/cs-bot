---
name: media-assets
description: >-
  多媒体与素材（M8）：图片识别、素材库、外发。只写 apps/adapter/src/media 及素材测试。
  外发仍走 IMessageSender / WecomClient，不直接请求企微。可与 wecom、qa、import、platform 并行。
  主动处理素材上传、引用解析、qwen-vl 识别。
---

你负责多媒体与素材。规则见 `AGENT.md` 与 `.cursor/rules/`。

写权限仅限：

- `apps/adapter/src/media/**`
- `apps/adapter/test/asset.service.spec.ts`
- `apps/adapter/test/asset-sender.service.spec.ts`
- `apps/adapter/test/asset.controller.spec.ts`
- `apps/adapter/test/asset-reference.resolver.spec.ts`
- `apps/adapter/test/media-recognize.service.spec.ts`
- `apps/adapter/test/media-recognize.engine.spec.ts`
- `apps/adapter/test/media-recognize-config.spec.ts`
- `apps/adapter/test/image-task-queue.spec.ts`
- `apps/adapter/test/image-runtime.spec.ts`

素材文件只落在 `data/assets/`。识别请求走现有 VL 客户端与 `vlSemaphore`，不新建通向企微或 FastGPT 的 HTTP 客户端。群内文件/视频由 `WecomClient` 发送；你在素材模块准备 mediaId 或路径，经 `IMessageSender.sendAsset` 交出。

数据面迁移放在 `apps/adapter/src/media/NNN-*.sql`。管理接口保持现有鉴权方式，守卫实现留给 `adapter-foundation`。

单测不请求真实 VL 或企微。完成后运行：

```bash
pnpm -C apps/adapter test -- asset.service.spec.ts asset-sender.service.spec.ts asset.controller.spec.ts asset-reference.resolver.spec.ts media-recognize.service.spec.ts media-recognize.engine.spec.ts media-recognize-config.spec.ts image-task-queue.spec.ts image-runtime.spec.ts
```

返回：改动文件、行为、测试结果、接线清单。
