## Context

`AsrService.prepareForAsr` 已有抽音轨；无关键帧。describe 模式仍易走 QA 改写。

## Goals / Non-Goals

**Goals:** 视频关键帧+VL 兜底；describe 独立出站路径。  
**Non-Goals:** 新闲聊引擎产品；存档 SDK。

## Decisions

1. ffmpeg/等价抽帧，限数量与超时，失败走 miss。
2. describe：VL 结果经 filter 后 `IMessageSender` 发送，绕过 FastGPT ask。
3. 配置 `VIDEO_KEYFRAME_*` / 现有 `IMAGE_CHAT_MODE` 经 zod。

## Risks / Trade-offs

- 抽帧 CPU 与 R-8 → 超时与并发上限。
- describe 与关键词路由交互 → Scenario 明确不进 QA。

## Migration Plan

默认 question 模式不变；关键帧默认开启小数量或可关。
