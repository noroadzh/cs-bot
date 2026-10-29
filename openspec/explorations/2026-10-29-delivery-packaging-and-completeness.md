# 交付打包边界与功能完整性复核（2026-10-29，只读 + 目录整理）

## 范围

- 复核 `close-runtime-followups` 归档后的 M1–M11 功能完整性。
- 核对“交付方内部能力（授权签发/证书）不得进入客户部署包”的实现边界。

## 功能完整性结论

M1–M11 的功能实现与主规格、测试均齐全；前两轮复核发现的 P1/P2 已在前两个变更中闭环，本轮未发现新的功能缺失。

已接受、不属缺口的限制：

- 群聊不支持被动回复（企业微信 appchat 限制，主动发送替代）。
- grace 期知识库只读依赖 FastGPT 后台外部配置。
- 管理面为纯 API（可视化归二期）。
- 租户导出以 Mongo 全量 dump 表达知识库。
- 真正多租户 UAT 受环境限制。
- “工作日”按周一至周五计算，未接法定节假日日历。

## 交付打包问题（本轮新发现）

### P1 默认 compose 把控制面与签发工具带给私有化客户

- `deploy/docker-compose.yml:53` 定义 `control-plane` 服务，`:85` 挂载 `../tools/license-issuer`，`:76-77` 指向 `issuer-private.pem`，并挂载 `/var/run/docker.sock`。
- 私有化客户执行 `docker compose up -d` 会一并启动控制面，等于交付了平台控制面与 Docker 守护进程访问能力。
- 违反：
  - 概设 M9：“私钥与签发工具仅存交付方”“成品系统交付不含源码”。
  - 详设 §8：“控制面镜像单独构建（SaaS 形态才交付）”。
  - 部署手册 §7.1：部署包仅含镜像、compose、nginx、config、.env 模板、SHA256SUMS。
- 建议：基线 compose 只保留 6 个服务；控制面拆到内部使用的 `docker-compose.saas.yml`，随 SaaS 部署单独下发。

### P2 签发私钥不在仓库，compose 引用其路径

- 仓库内不存在 `tools/license-issuer/issuer-private.pem`（只有 `packages/license-native/test_keys/test_signing_key.pem` 测试密钥）。
- 控制面 `LICENSE_ISSUER=shell` 时缺 key 会抛 `LICENSE_ISSUER_KEY is required`。
- 建议：SaaS 部署文档明确由交付方注入私钥；客户包不包含该路径。

### P2 缺少可重复的打包脚本

- 当前部署包靠人工挑选文件；`deploy/nginx/certs`、`license/` 属于按环境替换的产物（本次已入库跟踪），客户包必须排除后由客户证书/交付方签发的 license 替换。
- 建议：提供白名单打包脚本，生成 `cs-bot-deploy-<version>.tar.gz` 与 `SHA256SUMS`，并对“包含内部文件”直接失败。

## 追踪调整（已完成）

- `deploy/nginx/certs/`、`license/` 已纳入版本管理（commit `77b554e`），不再作为未跟踪文件排除；交付打包时单独处理。
