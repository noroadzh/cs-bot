# 设计

## 档位

`019-tenant-plan.sql` 增加 `tenant.plan`，默认 `standard`。`ShellProvisioner` 用两套 `mem_limit`：standard 合计约 5.9G，enhanced 合计约 12G。

## 单聊被动回复

仅当消息没有 `ChatId` 且 `REQUIRE_GROUP_CHAT_ID` 不为 true。用请求上下文挡住 `sendText`，等待 `PASSIVE_REPLY_MS`（默认 3500）。时限内拼出文本则 `WecomCrypto.buildPassiveReply` 写回；超时先回空包，已挡住的文本和后续发送走 `WecomClient.sendText`。

## 签发

`ShellLicenseIssuer` 调用 `license-issuer.mjs` 时只传 `--key --fingerprint --expires --max-chats`。设置 `LICENSE_SIGN_CMD` 时不读 PEM，把 payload JSON 写入该命令的 stdin，读取 stdout 的 base64 签名。`NODE_ENV=production` 且密钥路径落在 `test_keys/` 时失败。

## 邮件

`SubscriptionReminder` 分开租户邮件和运维 webhook。`SMTP_HOST` 非空时用 `SmtpNotifier`，否则用 `EMAIL_WEBHOOK_URL`。收件人是租户 `contact`；没有邮箱则跳过邮件。
