## 1. 规格与施工单

- [x] 1.1 对齐 tenant-provisioning / deployment-suite delta
- [x] 1.2 维护 `.cursor/plan/gap-v3-wildcard-acme-deepen.md`

## 2. 签发与续期

- [x] 2.1 DNS-01 / CERT_CMD 通配签发写入共享目录
- [x] 2.2 renew 任务或 `POST /platform/tls/wildcard/renew` + status
- [x] 2.3 过期/失败告警
- [x] 2.4 部署文档与脚本

## 3. 验证

- [x] 3.1 夹具/单测覆盖 wildcard renew 失败路径
- [x] 3.2 更新差距表通配 TLS 项
