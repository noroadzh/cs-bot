# Tasks

## 1. P0 增项 D：模型路由接线

- [x] 1.1 `config.schema.ts` 增加 `superRefine`：`MODEL_MODE=local|hybrid` 时校验 `LOCAL_LLM_BASE_URL` 必填且为 URL，缺失 fail-fast
- [x] 1.2 新增本地/云端 `ChatProvider` 实现（OpenAI 兼容 `/v1/chat/completions`），复用超时与 API Key 配置
- [x] 1.3 `QaModule` 增加 `MODEL_ROUTER` provider 并在 `onModuleInit` 注入 `QaOrchestrator.setModelRouter`；`cloud` 模式保持 `null`
- [x] 1.4 单测：hybrid 本地优先/失败切云、local 失败不出站、启动校验失败；更新 `model-router` 相关测试
- [x] 1.5 验收补充：`MODEL_MODE=local` 时链路不走 FastGPT 云引擎（mock 断言）

## 2. P0 部署迁移完整性

- [x] 2.1 `deploy/docker-compose.yml` 的 `docker-entrypoint-initdb.d` 补齐 `import/007-import-pipeline.sql`、`platform/008-control-plane.sql`
- [x] 2.2 `deploy/Dockerfile.adapter` 的 `/app/migrate` 补齐同一组 9 个 SQL
- [x] 2.3 新增 `scripts/check-migrations.sh` 与 `test/deploy-migrations.spec.ts`：源码迁移集合与部署配置集合一致，缺失即失败
- [x] 2.4 在 CI 中执行迁移一致性检查

## 3. P0 入站多媒体与 miss 字段

- [x] 3.1 新增 `src/miss/009-miss-media-status.sql`：`media_type VARCHAR(16)`、`status SMALLINT NOT NULL DEFAULT 0`，幂等 ALTER
- [x] 3.2 `MissService.record` 支持 `mediaType`，写入新列；`miss_record` 查询/导出返回 `mediaType`、`status`
- [x] 3.3 `WecomController` 增加 voice/video/file（@机器人）分支：发送固定引导话术 + 落 miss（media_type 对应值）+ 200 ack
- [x] 3.4 单测/验收：三种媒体各一例 + 未 @ 静默；导出字段包含 `mediaType/status`
- [x] 3.5 `GET /admin/miss-records` JSON 与 xlsx 输出补字段（保持向后兼容）

## 4. P0 M11 真实适配器

- [x] 4.1 `tenant.service` 的证书/授权签发改为配置选择（`CERT_PROVIDER`、`LICENSE_ISSUER`）；生产环境禁止 `fake/noop`（启动校验）
- [x] 4.2 实现 `FileCertificateProvider` 读取证书路径；实现 `ShellLicenseIssuer` 调用签发 CLI
- [x] 4.3 `PlatformModule` 的 `PlatformMonitor` 改为 HTTP 探测实例 `/healthz`（模板配置），聚合失败率
- [x] 4.4 `UpgradeOrchestrator` 依赖改为 docker 命令：快照、切镜像、健康检查、失败回滚；保留可注入接口供测试
- [x] 4.5 `TenantOffboarding`：导出使用 `ExportPackager` 生成加密包并落盘；删除调用 provisioner；保留双签校验
- [x] 4.6 单测/集成：真实适配器选择、生产禁用 fake、快照回滚与删除路径

## 5. P0 问答文本与质量

- [x] 5.1 新增 `normalizeQuestion(raw, prefixes)`：剥离 @机器人/@昵称与触发词前缀，压缩空白
- [x] 5.2 `QaOrchestrator` 守卫：空/纯标点/长度 >500 → 引导话术，不调模型、不落 miss
- [x] 5.3 `FastGPTQaEngine` 解析 `responseData[].quoteList`（兼容现有字段），统一 `quotes/score`
- [x] 5.4 orchestrator 追加来源引用（≤2 条 `—— 来源：《…》`），无 quote 不追加
- [x] 5.5 主通道失败重试 1 次（1s 退避）后再走 fallback
- [x] 5.6 单测：剥离/守卫/引用/重试各一例；更新既有问答用例

## 6. P1 路由、限流与保护

- [x] 6.1 `ALLOWED_CHAT_IDS` 配置 + routing 入口白名单判断；非白名单群静默且不落库
- [x] 6.2 限流反馈：群超限静默 + 5 分钟一次提示；单人超限回“提问太频繁，请稍后再试”
- [x] 6.3 Dedup Redis 异常时进程内 TTL Map 兜底（容量上限 + 清理）
- [x] 6.4 出站信号量（llm=4/wecom=8/vl=2，可配置）FIFO 排队，接入 FastGPT/WeCom/VL 调用
- [x] 6.5 关键词改 Trie 前缀匹配，reload 原子替换（对齐既有 spec）
- [x] 6.6 单测：白名单、限流提示、Redis 故障去重、信号量上限、Trie 热切换

## 7. P1 日志、素材与导入运维

- [x] 7.1 `AppLogger` 对 question/answer/content/text/reply 字段应用 `maskPII`；保留密钥 redact
- [x] 7.2 敏感词审计日志补 `hitWord`（不含原文）；单测
- [x] 7.3 素材按类型限制（file 20MB / video 10MB）、md5 去重、落盘 0600
- [x] 7.4 `IMPORT_MAX_FILE_BYTES` 默认 200MB；导入前校验 5 万条上限
- [x] 7.5 新增 03:40 清理任务：>30 天 review.xlsx、>180 天 import_item；单测
- [x] 7.6 导入解析循环内存保护：RSS >80% 暂停、恢复后继续（保留进度）
- [x] 7.7 单测覆盖 7.3–7.6

## 8. P1 交付加固

- [x] 8.1 新增 `tools/license-issuer`（CLI：payload → `base64(payload).base64(signature)`），README/用法
- [x] 8.2 引入 `javascript-obfuscator` 与 `obfuscate` 脚本，Dockerfile 启用（release 构建）
- [x] 8.3 生产构建关闭 sourceMap、镜像剔除 `*.map`、移除 `--enable-source-maps`
- [x] 8.4 新增 `scripts/release-sums.sh` 生成 `SHA256SUMS`（镜像 digest + 交付包）
- [x] 8.5 验证：构建产物无 `.map`、无 TS 源码、含混淆；签发 CLI 产物可被 verifier 接受

## 9. P1 M11 运营能力

- [x] 9.1 配额 80% 预警：按租户+维度+自然日去重，通知租户与运营；单测
- [x] 9.2 订阅提醒接入定时任务（每日 09:00 调 `SubscriptionReminder`）；Notifier 实现（邮件/群 webhook）
- [x] 9.3 `POST /platform/report` 控制面端点（仅计数）+ adapter 定时上报与 7 天失败缓冲
- [x] 9.4 grace 只读：禁止新群接入与知识库变更（网关/准入层），问答保持可用
- [x] 9.5 平台审计 180 天清理任务
- [x] 9.6 单测/集成覆盖 9.1–9.5

## 10. P2 验收补齐

- [x] 10.1 `load.spec.ts` 增加 `SUSTAINED_LOAD=1` 分支：50 并发 × 10 分钟，统计丢失数与 P95，报告落 `artifacts/`
- [x] 10.2 新增导入吞吐验收：1 万条 fixture 解析+配对 ≤10 分钟，报告落 `artifacts/`
- [x] 10.3 覆盖率门禁按既有 spec 落地（管道模块 80% / 横切 60%），CI 执行 `test:cov`

## 11. 验证

- [x] 11.1 `pnpm -C apps/adapter build`、单测、集成、验收全绿
- [x] 11.2 迁移一致性检查通过；模拟 fresh DB 验证 009 与 008 生效
- [x] 11.3 `openspec validate close-design-gaps-v2 --strict` 通过
- [x] 11.4 在 change 内记录已知限制（真实 6 容器/生产验证仍受网络与服务器可达性约束）
