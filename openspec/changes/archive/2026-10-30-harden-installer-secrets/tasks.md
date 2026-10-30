# Tasks

- [x] 1.1 `install.sh` 预检增加 `SHA256SUMS.txt` 校验（sha256sum / shasum 回退），不匹配即失败。
- [x] 1.2 `install.sh` 预检增加强口令校验（ADMIN/POSTGRES/FASTGPT_ROOT 必填；REDIS 可选），拒绝短/弱值。
- [x] 2.1 `.env.template` 与 `deploy/.env.template` 调整口令项为必填空值 + 生成示例。
- [x] 2.2 部署手册 §7.0/§7.3 补强口令与完整性校验提示；概设 §9 日志脱敏表述精确化。
- [x] 3.1 `install-script.spec.ts` 补校验和失败、弱口令拒绝、强口令通过用例。
- [x] 4.1 全量单测/集成/验收通过；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify harden-installer-secrets`，通过后 `/opsx:archive`。
