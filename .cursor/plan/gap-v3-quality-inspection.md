# gap-v3-quality-inspection（施工单）

- **OpenSpec**: `openspec/changes/gap-v3-quality-inspection/`
- **状态**: 实现完成
- **测试**: `pnpm -C apps/adapter test`（质检相关）+ admin-web vitest

## 顺序

1. SQL + service 落库  
2. API 扩展与 cooldown 告警  
3. `/quality` 页  
4. 勾选 tasks / 差距表
