# Proposal

## Why

P0 关闭后，运营闭环仍缺：学习建议答案与审核队列 UI、视频 ASR 失败/大小矩阵、知识/看板联调验收。不补齐则无法按差距表宣称「体验与运营闭环」可验收。

## What Changes

- 学习闭环：聚类后生成建议答案；运营台审核队列；自动学习审计可查（含前端页）
- 视频 ASR：抽音轨（或等价转写路径）、大小/超时上限、失败 → guidance + miss（`media_type=video`）对齐详设
- 知识代理与看板：一键补录与 stats 联调验收用例（补缺角角落落，非重做 API）
- **非本 change**：真实支付 SDK、企微存档 SDK、GPU/Prometheus/通配 TLS（P2）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `import-pipeline`: Optional zero-review auto learning — 建议答案、高风险排队、审计查询
- `media-recognition`: Voice and video transcription — 视频抽音轨与失败/大小矩阵
- `admin-console`: Usage dashboard + Knowledge proxy — 学习页、一键补录联调验收

## Impact

- `apps/adapter/src/learning/*`、`media/asr*`、`wecom` 回调分支、`apps/admin-web` 页面
- 施工单：`.cursor/plan/p1-ops-learning-asr.md`
- 依赖已归档主规格中的 auto learning / ASR / admin-console 基线
