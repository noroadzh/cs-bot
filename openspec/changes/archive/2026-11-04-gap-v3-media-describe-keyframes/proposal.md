## Why

视频 ASR 在无音轨/失败时缺少关键帧→VL 兜底；`IMAGE_CHAT_MODE=describe` 仍偏「改写后进 QA」骨架，未达到独立描述出站验收。

## What Changes

- 视频：音频提取失败或空转写时抽取关键帧，可选 VL 富化后再入路由/QA；双失败仍 guidance+miss
- 图片：`describe` 模式 MUST 产出用户可见描述答复，**不得**强制改写进 FastGPT QA；动态文案仍过 filter（R-3）
- 配置：关键帧数量/超时经 ConfigService + zod

## Capabilities

### New Capabilities

- （无）

### Modified Capabilities

- `media-recognition`: 视频关键帧管线；Image chat describe 收紧为 MUST

## Impact

- 代码：`media/asr.service`、`wecom.controller` 媒体分支、单测
- 非目标：独立闲聊大模型产品；改 R-1～R-8；存档 SDK（另 change）
