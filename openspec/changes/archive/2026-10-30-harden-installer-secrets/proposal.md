# Proposal

## Why

第十三轮复核（`openspec/explorations/2026-10-30-design-completeness-recheck-13.md`）发现概设 §9 的两条「强制」安全项未在安装链路落地：交付包已附 `SHA256SUMS.txt`，但 `install.sh` 从不校验（§9 要求「重算不一致则拒绝 compose up」）；`install.sh` 也不拦截弱口令，客户按模板部署即带 `cs / fastgpt123456 / please_change_me` 等默认值（§9 要求「FastGPT 后台口令强密码」）。

## What Changes

- **完整性校验**：`install.sh` 预检检测 `SHA256SUMS.txt`，存在则按 `sha256sum -c`（macOS 回退 `shasum -a 256 -c`）校验，任何不匹配即失败并列出文件；缺失时 WARN（开发/自建包）。
- **强口令校验**：`install.sh` 预检校验 `ADMIN_PASSWORD`、`POSTGRES_PASSWORD`、`FASTGPT_ROOT_PASSWORD`：必填、长度 ≥12、拒绝已知弱默认；`REDIS_PASSWORD` 若填写同样要求 ≥12。
- **模板**：`.env.template` 与 `deploy/.env.template` 将 `ADMIN_PASSWORD` 改为空值并注释「必填强口令，示例 `openssl rand -base64 24`」；补 `POSTGRES_PASSWORD`/`FASTGPT_ROOT_PASSWORD` 说明。
- **文档**：部署手册 §7.3 与 §7.0 提示强口令与校验和；概设 §9 日志脱敏表述精确化（正文全级别脱敏而非“不记”）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `deployment-suite`：新增「交付包完整性校验」与「强口令预检」要求。

## Impact

- **文件**：`deploy/install.sh`、`.env.template`、`deploy/.env.template`、部署手册、概设 §9、`install-script.spec.ts`。
- **行为**：弱口令/校验和不匹配时安装中止并给出可操作提示；正常包不受影响。
