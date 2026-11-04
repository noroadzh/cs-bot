## 1. 规格与施工单

- [x] 1.1 确认本 change proposal/design/delta 与差距表 P1 对齐
- [x] 1.2 维护 `.cursor/plan/p1-ops-learning-asr.md` 与 openspec 互链

## 2. 学习闭环

- [x] 2.1 聚类输出建议答案草稿（可规则/LLM，默认不自动入库）
- [x] 2.2 高风险队列：开关开启也不自动入库
- [x] 2.3 自动学习审计可查询（API + 持久化若仍内存则落库）
- [x] 2.4 admin-web 学习审核/审计页

## 3. 视频 ASR

- [x] 3.1 视频抽音轨（或等价）再 ASR
- [x] 3.2 大小/超时配置与失败 → guidance + miss(`video`)
- [x] 3.3 单测覆盖超限与 ASR 失败矩阵

## 4. 知识/看板联调

- [x] 4.1 看板页绑定 `/admin/stats/overview` 验收用例
- [x] 4.2 一键补录经 FastGPTClient + 知识状态刷新验收用例

## 5. 验证

- [x] 5.1 `pnpm -C apps/adapter test` 相关套件
- [x] 5.2 需要时补 admin-web 冒烟说明
