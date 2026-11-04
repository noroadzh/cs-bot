# Design

## Context

差距表 P1（学习闭环、视频 ASR、知识/看板联调）。后端已有 `/admin/learning/*` 骨架与 ASR 入口；缺建议答案生成、审核队列 UI、视频抽音轨与超时矩阵、前端学习页与补录联调。

## Goals / Non-Goals

**Goals**

- 运营可在控制台看到学习建议、审核后入库、查询 auto-learning 审计
- 视频 @ 机器人走 ASR；超限/失败行为与详设 miss 矩阵一致
- 看板与知识一键补录有可重复验收用例

**Non-Goals**

- 真实支付 / 存档 SDK / GPU / Prometheus / 通配 TLS
- 重写 FastGPT 知识存储（仍 R-2 经 `FastGPTClient`）

## Decisions

1. **建议答案**：优先用已有聚类 + 可选 LLM/规则生成草稿；高风险（敏感命中、拒答簇）强制人工队列，即使 `AUTO_LEARNING_ENABLED`。
2. **审计**：auto-ingest 写可查询审计（可落库或沿用现有 audit list 并持久化）；运营台只读查询。
3. **视频 ASR**：优先 ffmpeg/系统工具抽音轨再调 ASR；不可用时明确失败码 + guidance + miss；配置大小与超时上限。
4. **前端**：admin-web 新增学习页；看板/知识补录只补联调与缺页，不改 R-2。

## Risks / Trade-offs

- 抽音轨依赖运行时二进制：镜像需带工具或文档声明；无工具时降级路径必须可测。
- 建议答案质量不稳定：默认不自动入库，除非开关开且非高风险。

## Migration Plan

无破坏性 API；新页与配置项向后兼容默认关闭自动学习。
