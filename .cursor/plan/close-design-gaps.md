# 补齐设计缺口

完成度分析里的 6 项都要改。本文件是仓库内的计划副本，便于在项目 `.cursor/plans/` 里直接看到。Cursor 计划面板用的是用户目录里的另一份：`~/.cursor/plans/close_design_gaps_0f078cb3.plan.md`。

## 1. 非功能指标没有默认实测

概设要的是问答 P95 ≤ 8 秒、图片识别 P95 ≤ 12 秒、导入 1 万条 ≤ 10 分钟、跨租户检索 0 命中。`apps/adapter/test/acceptance/load.spec.ts` 只量回调 ack，且未设 `TEST_PG_URL` 时整组 skip。

补四条可重复验收，默认单测不打外网：

- 文本管道：mock 引擎注入固定模型延迟，从进入编排到 `IMessageSender.sendText`，扣除该延迟后的适配层耗时落在概设非 LLM 预算内（路由 0.2s + 上下文 0.1s + 过滤与发送 0.4s + 冗余 1.3s）。回调 ack 的 P95 ≤ 8 秒保留，并写明它不代替端到端问答。
- 图片路径：mock 下载与 VL，断言识别加问答的编排耗时（扣除注入延迟）落在 12 秒预算内。
- 导入：`apps/adapter/test/acceptance/import-throughput.spec.ts` 在跑起来时把解析+配对耗时写入 `artifacts/`；无 `TEST_PG_URL` 时仍 skip。
- 跨租户：确认 `apps/adapter/test/integration/tenant-isolation.spec.ts` 覆盖「抽测检索 0 命中」；缺断言则补上。

真实 DeepSeek / 真实 VL 的墙上时钟仍只在 `REAL_COMPOSE=1` 时跑。

## 2. 单聊 3.5 秒被动回复

`apps/adapter/src/wecom/wecom.controller.ts` 在有无 `ChatId` 时都是立刻回空包再主动发送。概设 M1 和详设 §3.1 要求：群聊主动发送；单聊/应用消息先被动回复，3.5 秒内未完成再回空包并主动补发。

有 `ChatId` 的群消息保持现状。没有 `ChatId` 的消息：

- 启动管道，等待最多 3500ms。
- 时限内得到最终文本：用现有 `WecomCrypto` 加密，按企微被动回复格式写回响应。
- 超时：先回空包，答案就绪后走 `WecomClient.sendText`。
- 同一条消息只发一次，靠现有 `client_msg_id` / msgid 去重。

补 `wecom.controller.spec.ts`：群聊立即 ack、单聊赶上限内被动回复、单聊超时转主动发送。

## 3. SaaS 只有 standard 档内存模板

`tenant.plan` 只写进审计，开通时读不到。控制面迁移 `apps/adapter/src/platform/019-tenant-plan.sql`：`plan text not null default 'standard'`，只允许 `standard` / `enhanced`。创建租户时写入该列，`Tenant` 带上字段。

`shell-provisioner.ts` 按档位写六服务 `mem_limit`：

- `standard`：128m / 512m / 2560m / 1229m / 1024m / 512m（合计约 5.9G）
- `enhanced`：256m / 1024m / 5120m / 2560m / 2048m / 1024m（合计约 12G，落在概设 8C16G 内）

空值按 `standard`。更新 `openspec/specs/tenant-provisioning/spec.md` 里「一律不得超过 standard 预算」的场景，改成按档位分别设上限。补渲染断言。

## 4. 生产签发还不是 KMS/HSM

`ShellLicenseIssuer` 传入 `issue --tenant --host --key`，而 `tools/license-issuer/license-issuer.mjs` 只认 `--key --fingerprint --expires --max-chats`，且按成对参数解析，前缀 `issue` 会把标志错位。开发 CLI `packages/license-native/bin/license.js` 则始终读仓库里的测试私钥。

- 控制面只传交付 CLI 支持的参数，并用临时密钥跑通签发测试。
- `NODE_ENV=production` 时，密钥路径落在 `packages/license-native/test_keys/` 则签发失败。
- 增加 `LICENSE_SIGN_CMD`。设置后，签发不读取 PEM，而是把 payload JSON 交给该命令，由它返回 base64 签名。交付方用这条命令接自己的 KMS 或 HSM（例如云 CLI、`pkcs11-tool`），仓库不绑定某一家云 SDK。
- 未设置 `LICENSE_SIGN_CMD` 时仍用 `LICENSE_ISSUER_KEY` 指向的外部 PEM。开发环境的 `license.js` 继续默认测试私钥。

## 5. 到期「邮件」目前只是 webhook

`EmailWebhookNotifier` 把正文 POST 到 `EMAIL_WEBHOOK_URL`，而且到期扫描把收件人写成字面量 `'tenant'`，没有用租户 `contact`。

- 提醒查询带上 `contact`。租户侧收件人用联系邮箱；没有联系人则跳过邮件并打 WARN。运维侧仍走群 webhook。
- 增加 `SmtpNotifier`：配置了 `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`（以及可选的用户名、密码）时，用 SMTP 把 T-30/15/7 提醒发给联系邮箱。
- `EMAIL_WEBHOOK_URL` 保留，作为没有 SMTP 时的网关。两者都没配则只打日志，不假装已发信。
- 配置进现有 zod schema，缺主机时不在启动 fail-fast（邮件不是问答必填项）。

## 6. 概设仍写库名 `tenant_{id}`

概设 M11 开通步骤仍写独立库名 `tenant_{id}`。详设和 `shell-provisioner.ts` 已是每租户一套实例、库名 `csbot`。

只改概设这一处表述，使之与详设和渲染结果一致。不改运行时库名。

## 顺序与分工

行为变更先写一份 openspec change，覆盖上述 6 项，再改代码。`wecom-adapter`、`platform-saas`、`license-core`、`adapter-foundation` 按目录并行。`app.module.ts` 与 `packages/shared` 仅在 SMTP 配置必须改 schema 时由 `adapter-foundation` 修改。完成后跑对应 spec，并由 `boundary-reviewer` 做只读核对。
