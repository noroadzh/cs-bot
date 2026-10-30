# 概设/详设 与实现核对（第 23 轮，素材外发链路 + 状态枚举）

日期：2026-10-30
范围：《概要设计 V1.27》全 13 节、《详细设计 V1.17》全 10 节，对照 `apps/adapter/src`、`deploy/`、`scripts/`、`openspec/specs`。

## 一、功能缺陷（实现与设计/规格不一致，需改代码）

| # | 位置 | 现状 | 设计/规格要求 | 影响 |
|---|---|---|---|---|
| F1 | `qa/qa-orchestrator.ts:136` | 调 `assetSender.send(chatId, {id, type})`，丢失 `url`/`name` | `media-management`「passes type and url to the asset sender」 | file/video 素材永远上传失败（只有 WARN），用户收不到附件 |
| F2 | `media/asset-sender.service.ts` | 直接把 `asset.url`（`/assets/<id>.<ext>` 相对 URL）当文件路径 | 素材落盘 `data/assets/` | 即便传了 url，`createReadStream('/assets/...')` 仍失败 |
| F3 | `media/asset-sender.service.ts` | link 只发 URL | 概设 M8：link → `sendText`（标题 + URL） | 群里只看到裸链接，无标题 |
| F4 | `qa/qa-orchestrator.ts:136-142` | 素材失败仅 WARN | 概设 M8：任一素材发送失败即**补发降级提示话术** | 用户静默感知不到附件缺失 |
| F5 | `media/asset.service.ts:161` | 仅 `type==='file'` 才删落盘文件 | video 同样落盘 `data/assets/` | 删除视频后文件遗留（磁盘泄漏 + 容量统计虚高） |
| F6 | `platform/007+015` 约束 | `chk_tenant_status` 不含 `trialing` | `tenant-registry`：`trialing → active → grace → …`；实体/状态机/扫描均含 trialing | 任何 trialing 写入 500；sweep 的 trialing 分支为死代码 |

## 二、文档偏差（需对齐实现）

| # | 文档位置 | 偏差 |
|---|---|---|
| D1 | 概设 M8 | 写「DELETE … 逻辑停用」「查 asset 表（enabled=true）」，实际物理删除、无 enabled 列 |
| D2 | 概设 M11、详设 §3.10 | 写「grace(7 天只读)」「grace+7d → suspended（签失效证书/置 license 过期）」；实际 grace 无只读限制，grace+7d → `paused`（suspended 别名）执行 `docker compose stop` |
| D3 | 概设 §7.4 | status 枚举漏 `trialing` |
| D4 | 概设 §7.4 | 配额列名与规格名映射未说明（`max_api_calls`=max_msgs_per_day、`max_users`=max_concurrent_qa） |
| D5 | 详设 §1 设计基线 | 写 PG15 / Mongo6；概设与 compose 为 PG16 / Mongo7 |
| D6 | 详设文首 | 上游写《概设 V1.26》、日期 2026-10-29；应为 V1.27 / 2026-10-30 |
| D7 | 概设 M2 | 出厂触发配置样例（`triggers.at_robot` / `prefixes: 客服：…`）与 `config/keywords.yml`（`keywords:` 列表）不符 |
| D8 | 详设 §3.2 | 关键词示例同上不符，且未说明为「前缀匹配」 |
| D9 | 概设 M1 | `uploadMedia(type, buffer)`、`sendFile(chatid, mediaId, title)` 与实际 `(type, filePath)`、`(chatId, mediaId)` 不符 |
| D10 | 详设 §3.4 | 写 `FastGPTClient.ask(...)`；实际问答为 `engine.ask`，客户端只有 `chat` |
| D11 | 详设 §3.9 | 写 `FastGPTClient.upsertQa(...)`；实际 `ensureDataset` + `writeBatch` |
| D12 | 详设 §7 | 把 license 复核记为 `@nestjs/schedule` cron；实际自调度 setTimeout 链。09:00 项实为订阅 T-30/15/7 提醒；license 15 天提醒在 03:00 夜间任务内 |
| D13 | 概设 §8.1 | 写响应「纯文本 success」；实际 200 空体（规格亦为 empty success body） |
| D14 | 概设 §6.4 | 繁忙话术引用不完整 |
| D15 | 概设 §7.1 | `asset.url` 说明只覆盖 link；文件类为 `/assets/<id>.<ext>` |
| D16 | 概设 §6.2 | 写「同时写入 M5（毫秒级，同步）」；实际 `setImmediate` 异步 + FIFO 重试 |
| D17 | 部署手册 §1 | 关联文档仍写 概设 V1.20 / 详设 V1.11 |
| D18 | 概设 §7.1 / media-management 规格 | 落盘名写 `data/assets/<id>`；实际 `data/assets/<id>.<ext>` |

## 三、已核对且一致（抽样）

- 限流/去重/上下文键与 TTL、时钟与 cron（03:30/03:40/03:50/09:00/02:30）、迁移文件索引（001–017）、平台接口清单、配额 80% 预警、T+7 注销、升级金丝雀与 10% 批次、日志脱敏路径、镜像混淆与 distroless、备份三库。

## 四、结论

6 项功能缺陷 + 18 处文档偏差，一次性修复并补测试（素材外发端到端、视频删除、trialing 写入）。
