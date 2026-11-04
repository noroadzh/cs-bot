## 1. 规格与施工单

- [x] 1.1 对齐 tenant-provisioning delta
- [x] 1.2 维护 `.cursor/plan/gap-v3-post-provision-fingerprint-license.md`

## 2. 探针与重签

- [x] 2.1 `GET /internal/instance/fingerprint`
- [x] 2.2 开通后 collect → reissue → deploy → reload
- [x] 2.3 pending 标记与运营重试 API
- [x] 2.4 单测（不可达 / 幂等）

## 3. 验证

- [x] 3.1 平台/internal 相关单测通过
- [x] 3.2 更新差距表指纹项
