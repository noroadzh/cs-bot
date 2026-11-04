# P1 运营闭环（施工单）

- **OpenSpec**: `openspec/changes/p1-ops-learning-asr/`
- **对照**: `.cursor/plan/design-gap-matrix.md` §5 P1
- **主规格 delta**: `import-pipeline` / `media-recognition` / `admin-console`
- **状态**: 实现完成，待 sync/归档（用户确认后）

## 已完成

1. 学习建议答案 + 高风险队列 + `learning_audit` 持久化（`src/learning`，SQL `miss/018`）
2. admin-web `/learning` 审核/审计页
3. 视频 ASR：`prepareForAsr` 抽音轨 + 大小限额；失败仍 guidance + miss
4. 看板/知识 vitest 联调用例 + `docs/03-交付实施/admin-web-p1-冒烟说明.md`

## 非目标

真实支付、存档 SDK、GPU、Prometheus、通配 TLS（P2）

## 验证

- `pnpm -C apps/adapter exec jest --testPathPattern='learning-auto|asr-media'` 通过
- `pnpm -C apps/admin-web test` 通过（7）
