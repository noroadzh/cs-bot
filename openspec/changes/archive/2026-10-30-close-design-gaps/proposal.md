# 补齐设计缺口

## Why

概设/详设里还有 6 处未闭环：验收只量回调 ack、单聊没有 3.5 秒被动回复、租户档位不进开通模板、控制面签发参数与 CLI 错位且生产可用测试私钥、到期提醒不发给联系人且没有 SMTP、概设仍写库名 `tenant_{id}`。

## What Changes

- 默认可重复的管道耗时、图片预算验收；导入吞吐写入报告；跨租户抽测至少 20 条。
- 无 ChatId 且未强制群聊时，3.5 秒内被动加密回包，超时再主动发送。群消息仍立即 ack。
- `tenant.plan` 持久化为 `standard` 或 `enhanced`，compose 内存限额按档位渲染。
- 控制面按交付 CLI 的参数签发；生产拒绝仓库测试私钥；`LICENSE_SIGN_CMD` 把 payload 交给外部签名命令。
- 到期提醒发给租户联系邮箱；配置了 SMTP 则走 SMTP，否则仍可用邮件 webhook。
- 概设 M11 库名改为每实例 `csbot`。

## Non-goals

- 不在默认单测里调用真实 DeepSeek 或真实视觉模型。
- 不绑定某一家云 KMS SDK。
- 不改变群聊「立即 ack + 主动发送」。`REQUIRE_GROUP_CHAT_ID=true` 时缺少 ChatId 仍丢弃。
