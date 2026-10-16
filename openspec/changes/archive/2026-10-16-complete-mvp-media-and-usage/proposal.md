# Proposal

## Why

当前 MVP 交付存在三个关键功能缺失：素材管理 CRUD 仅 22 行存根无法支撑多媒体外发；图片识别未接入 qwen-vl 引擎；用量上报仅有配置项但无实际上报逻辑。这三项是 M8 增项包的核心组成，直接影响客户演示与 SaaS 化计费。

## What Changes

1. **素材管理 CRUD** - 补齐 `AssetSenderService` 存根为完整实现：
   - 新增 `asset` 数据库表（id, type, url, path, chat_id, created_at）
   - 新增 `AssetService` 提供 CRUD 接口
   - 新增 `POST /admin/assets` 上传、`GET /admin/assets` 列表、`DELETE /admin/assets/:id` 删除
   - 保留 `AssetSenderService` 作为发送入口

2. **图片识别（qwen-vl）** - 启用多媒体理解：
   - 新增 `MediaRecognizeService` 封装 qwen-vl API
   - 在消息入口检测图片消息，调用识别后追加到用户问题
   - 支持 `image/*` 类型，识别结果作为上下文

3. **用量上报** - 实现 D10 SaaS 计费基础：
   - 新增 `UsageService` 聚合每日/每周/每月消息数、token 消耗、素材发送次数
   - 新增 `GET /admin/usage` 查看当前周期用量
   - 可配置上报到外部 webhook（预留接口）

## Capabilities

### New Capabilities

- `media-management`: 素材管理（上传、存储、列表、删除、外发）
- `media-recognition`: 图片识别（qwen-vl 集成、结果注入问答）
- `usage-reporting`: 用量统计（计数、聚合、查询、webhook 上报）

### Modified Capabilities

- `admin-api`: 新增 `/admin/assets/*` 与 `/admin/usage` 端点
- `qa-orchestration`: 新增图片识别结果作为上下文输入

## Impact

- **代码影响**：
  - `apps/adapter/src/media/` 新增 `asset.service.ts`, `media-recognize.service.ts`
  - `apps/adapter/src/admin/` 新增 `asset.controller.ts`, `usage.controller.ts`
  - `apps/adapter/src/usage/` 新增 `usage.service.ts`, `usage.module.ts`
  - `packages/shared/src/` 新增 `usage.types.ts`
- **数据库**：新增 `asset` 表（需要 migration）
- **配置**：新增 `QWEEN_VL_API_KEY`, `QWEEN_VL_BASE_URL`, `USAGE_WEBHOOK_URL`
- **依赖**：新增 `form-data`（已有）、`axios`（已有）