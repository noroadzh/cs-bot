# Tasks

## 1. P0 租户导出补全

- [x] 1.1 新增 `TenantExportService`：调用 FastGPT 数据集导出 API 拉取知识库文档、复制资产文件字节、执行租户 `pg_dump`、汇总配置（密钥只留 key 名）；验证：单测断言四类内容非空且解密可读。
- [x] 1.2 导出流程流式打包 + 租户密钥加密 + 0600 输出，失败清理临时目录；验证：集成测试用真实 PG + fake FastGPT 导出，解密后 KB/assets/dump 均存在。
- [x] 1.3 文档补充导出包内容/校验命令；验证：部署手册步骤可执行。

## 2. P1 续期与控制面运维

- [x] 2.1 renew 先调用 `licenseIssuer.issue` 再更新订阅，失败不落库；审计 payload 增加 `licenseIssued`；验证：单测签发失败保持原到期时间，成功则实例同步新 license。
- [x] 2.2 compose 控制面默认不发布端口，`CONTROL_PLANE_BIND` 为空/0.0.0.0 时不渲染 `ports`；验证：`docker compose config` 断言无 3100 映射，设置管理地址后仅绑定该地址。
- [x] 2.3 `backup.sh` 增加控制面库 dump 与 manifest；验证：脚本在 temp 目录运行后产物含 `pg_control_<date>.sql`。
- [x] 2.4 凭证一次性交接：provision/专用 endpoint 返回生成的 admin/FastGPT 根口令一次，第二次 410，日志/审计不含值；验证：单测覆盖首次返回、二次拒绝、日志脱敏。
- [x] 2.5 续期/控制面文档更新（端口访问方式、备份清单、凭证交接）；验证：文档命令与实现一致。

## 3. P1 图片链路

- [x] 3.1 图片回调先 ack，再投递有界 `ImageTaskQueue`（msgId 去重、VL 并发限制）；验证：单测断言 send 在识别前调用，重复 msgId 只处理一次。
- [x] 3.2 识别改为 10s 超时、`QWEN_VL_MODEL`、真实 MIME、咨询问题提取提示词与 `[NO_TEXT]` 处理；验证：单测覆盖模型名、超时、PNG MIME、`[NO_TEXT]` 走引导。
- [x] 3.3 文档更新图片链路行为；验证：PRD 验收项 9 的操作步骤可执行。

## 4. P1 导入异步与合规

- [x] 4.1 新增迁移 016：`import_job.dataset_id`、`tenant_quota` 容量维度、`tenant_usage_daily` 容量字段；验证：迁移幂等执行，`check-migrations` 通过。
- [x] 4.2 parse 改为 202 + 进程内后台任务（复用租约）；启动把中断的 `parsing` 置 failed，允许 retry；验证：集成测试断言 202、轮询状态、重启后失败可重试。
- [x] 4.3 源文件写盘 0600；`failJob` 立即清理 source；验证：文件 mode 断言 + 失败后目录不存在。
- [x] 4.4 脱敏增加 ADDRESS/NAME 两类占位符与 flags，保守词典 + 强制人工复核；验证：单测覆盖地址/姓名/无命中，e2e 断言敏感项不可批量通过。
- [x] 4.5 Dataset 客户端 3 次指数退避（仅 5xx/网络），持久化 `dataset_id`，rollback 重启后仍可删除；验证：单测 5xx 重试 3 次、4xx 不重试；集成测试重启后 rollback 成功。
- [x] 4.6 更新导入合规文档（文件权限、脱敏类型、重试/回滚）；验证：文档与 API 一致。

## 5. P1 未配对补配

- [x] 5.1 新增 `GET /admin/import-jobs/:id/unpaired` 与 `POST .../unpaired/pair`，事务内创建 pending item、删除 pool 记录、重算计数；验证：集成测试补配后 item 出现、pool 减少、未补配不入库。
- [x] 5.2 补配项复用脱敏/黑名单/去重与审核清单；验证：补配含手机号的答案生成 `<PHONE:1>` 且进入 pending。
- [x] 5.3 操作手册补补配流程；验证：curl 示例可执行。

## 6. P2 过滤、上下文与接口契约

- [x] 6.1 敏感词命中整段替换固定话术，日志只记 hit 元数据；验证：单测断言输出为固定文本且日志不含原文。
- [x] 6.2 `CONTEXT_ROUNDS` 生效（默认 5）；验证：单测 `CONTEXT_ROUNDS=3` 只保留 3 轮。
- [x] 6.3 `miss-records` 支持 `from`/`to` 并保留 `days`；验证：单测日期过滤边界与 xlsx 文件名。
- [x] 6.4 触发配置兼容 `triggers.prefixes` 与 `keywords`；验证：单测两种配置均按前缀触发。
- [x] 6.5 拒答默认文案改为设计文本；验证：配置默认值断言 + 低分回复测试。

## 7. P2 配额、用量、审计、升级与告警

- [x] 7.1 配额增加 `maxDocs/maxQa/maxAssetMb`，详情/下发/用量查询返回；验证：单测 PATCH 三维度、持久化与审计 before/after。
- [x] 7.2 日用量上报增加 `docCount/qaCount/assetMb`，控制面持久化；验证：单测 payload 与控制面 upsert。
- [x] 7.3 审计请求 DTO 增加必填 `reason`，缺失 400；动作表增加 `shell_access`；验证：单测缺失 reason 拒绝、动作词表校验。
- [x] 7.4 升级窗口 02:00–04:00 + 提前 3 个工作日通知 + 紧急覆盖审计；验证：单测窗口外延迟、通知、force 审计。
- [x] 7.5 群上限拒绝发送运维告警并按群 24h 去重；验证：单测拒绝告警一次、重复不告警。
- [x] 7.6 文档更新配额维度、审计 reason、升级窗口与告警；验证：文档与实现一致。
- [x] 7.7 到期提醒增加邮件通道（保留 webhook），T-30/15/7 同时发租户与运维；验证：单测两种通道各收到一次，失败不影响主流程。
- [x] 7.8 对齐日配额 100% 行为：保留“达到上限拒绝消息”的实现，修订概设描述为“停止受理新消息并回配额提示”，避免与现有规格冲突；验证：设计文档与 `Daily message quota enforcement` 一致。
- [x] 7.9 审计留存运维：提供 180 天前审计导出脚本（异地留存由部署方执行），清理前可导出；验证：脚本在种子数据上导出 JSONL 且不删库。

## 8. P2 local-model-routing 收敛

- [x] 8.1 按规格改写运行时：所有模式 FastGPT RAG，local 禁止云回退，hybrid 失败回落；验证：单测三模式路由与回退计数。
- [x] 8.2 hybrid 30s 健康探测 + 5 分钟恢复滞回；验证：fake timers 单测探测/恢复。
- [x] 8.3 文档同步 FastGPT 架构与本地模型通道配置；验证：部署手册 local/hybrid 步骤可执行。

## 9. 验证与归档

- [x] 9.1 全量单测、集成、验收通过；`check-migrations` 与 compose config 通过。
- [x] 9.2 镜像重建并验证非 root/可写/迁移包含 016；真实导出包抽样解密校验。
- [x] 9.3 更新设计文档与操作手册；验证：文档与实现一致。

## Workflow follow-up

- 运行 `/opsx:verify complete-design-runtime-gaps`，通过后 `/opsx:archive`。
