# Tasks

- [x] 1.1 部署手册 §3/§5/§11 端口表述改为 443 + 8443（白名单）+ 22。
- [x] 1.2 概设 §9 端口基线与传输安全表述修正。
- [x] 1.3 概设 M6 敏感词算法改为 Aho-Corasick。
- [x] 1.4 详设 §6.4 授权接口响应按 `LicenseState` 重写。
- [x] 1.5 版本与交叉引用同步（概设 V1.16 / 详设 V1.9 / 手册 V1.12）。
- [x] 2.1 全文检索无「仅 443」残留（版本记录除外）；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify align-security-docs-round10`，通过后 `/opsx:archive`。
