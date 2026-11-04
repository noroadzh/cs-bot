## 1. 规格与施工单

- [x] 1.1 对齐差距表质检项与本 change
- [x] 1.2 维护 `.cursor/plan/gap-v3-quality-inspection.md`

## 2. 持久化与 API

- [x] 2.1 `quality_inspection` 迁移 SQL
- [x] 2.2 扩展 quality-check 落库 + `inspectionId`
- [x] 2.3 `GET /admin/archive/quality-inspections`
- [x] 2.4 阈值告警 + cooldown webhook

## 3. 运营台

- [x] 3.1 admin-web `/quality` 页 + 菜单
- [x] 3.2 冒烟/单测覆盖 Scenario

## 4. 验证

- [x] 4.1 adapter 相关单测通过
- [x] 4.2 更新差距表质检状态
