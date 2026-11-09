# 剩余缺口总览（P3 已 verify/sync/归档）

- **对照**: `.cursor/plan/design-gap-matrix.md`
- **状态**: 6 个 `gap-v3-*` change **已实现、已 sync 主规格、已归档**（`openspec/changes/archive/2026-11-04-gap-v3-*`）
- **共享非目标**（各 change proposal 均引用）:
  - 单进程多租户 ALS
  - OAuth/SSO、细粒度权限点矩阵、跨库身份联邦（用户表 RBAC 已由 `admin-user-rbac` 交付）
  - k8s GPU Operator / LoRA 训练执行器（保持 P2 外部 worker）
  - 微信个人号（永久排除）

## Change 清单（已归档）

| 顺序 | Change | 归档路径 | 主规格 |
|---|---|---|---|
| 1 | `gap-v3-quality-inspection` | `archive/2026-11-04-gap-v3-quality-inspection` | `quality-inspection` + import/admin |
| 2 | `gap-v3-media-describe-keyframes` | `archive/2026-11-04-gap-v3-media-describe-keyframes` | `media-recognition` |
| 3 | `gap-v3-wecom-archive-pull` | `archive/2026-11-04-gap-v3-wecom-archive-pull` | `wecom-session-archive` |
| 4 | `gap-v3-post-provision-fingerprint-license` | `archive/2026-11-04-gap-v3-post-provision-fingerprint-license` | `tenant-provisioning` |
| 5 | `gap-v3-platform-billing-sdk` | `archive/2026-11-04-gap-v3-platform-billing-sdk` | `tenant-registry` + audit/admin |
| 6 | `gap-v3-wildcard-acme-deepen` | `archive/2026-11-04-gap-v3-wildcard-acme-deepen` | `tenant-provisioning` + `deployment-suite` |

## 验收

每个 change：`verify`（tasks 100% + 聚焦单测）→ sync 主规格 → `mv` 至 `archive/2026-11-04-<name>/`。

后续加深（非本轮立项）：官方支付 SDK 深度绑定、企微存档官方 SDK 替换 adapter、学习聚类自动化等。
