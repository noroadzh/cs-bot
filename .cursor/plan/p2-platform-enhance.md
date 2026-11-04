# P2 平台增强（施工单）

- **OpenSpec**: `openspec/changes/p2-platform-enhance/`
- **对照**: `.cursor/plan/design-gap-matrix.md` §5 P2（8–11）
- **主规格 delta**: `local-model-routing` / `observability-logging` / `tenant-provisioning`
- **状态**: 已 sync + 归档 → `openspec/changes/archive/2026-11-04-p2-platform-enhance`

## 顺序

1. GPU 健康探测 → router 跳过 unhealthy  
2. LoRA job 表 + API + complete 登记  
3. `/metrics`（可开关 + 白名单）  
4. `PLATFORM_TLS_MODE=wildcard` SNI 挂载  
5. 单测与勾选 tasks  

## 非目标

完整 k8s GPU operator、云账单、改企微 QA 热路径依赖

## 验收锚点

- Unhealthy endpoint skipped / Fine-tune job tracked off hot path  
- Scrape returns prometheus text / Metrics disabled or guarded  
- Wildcard SNI attach on provision  
