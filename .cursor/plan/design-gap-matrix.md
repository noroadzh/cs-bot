# 概设/详设 vs 实现：完成度对照表

- **基准文档**：概要设计 V1.31、详细设计 V1.21、openspec `absorb-phase2-into-phase1`
- **代码基准**：`main` @ `8c6b9ef` 前后工作区（含一期并入骨架）
- **状态定义**
  - **完成**：主路径可交付，行为与概设大体一致（允许小差异）
  - **骨架**：有模块/API/配置，但未接热路径、无持久化或未达生产验收
  - **未做 / 大缺口**：概设有明确要求，代码缺失或仅占位
  - **永久排除**：微信个人号（文档已改口径）

---

## 0. 总览

| 范围 | 完成 | 骨架 | 大缺口 |
|---|---|---|---|
| 基线管道 M1–M7 + M9 加固 | 为主 | 少 | 少 |
| 增项 M8 / M10 | 为主 | ASR 增强；存档 SDK 拉取 | — |
| M11 SaaS 控制面 | 大部分 | 真实支付 SDK；单进程多租户 ALS | 通配 TLS/SNI 全自动等 |
| 原二期并入（看板/RBAC/知识/学习/GPU） | 部分运营台 | GPU 编排后端仍非 k8s | — |

**结论**：私有化「基线 + 增项 A/B + 授权」可按 MVP 交付；**不能**宣称概设/详设全部功能生产完成。原二期并入项多数仍是接口级骨架。

---

## 1. 核心模块（概设 §5）

| 模块 | 状态 | 证据 / 缺口 |
|---|---|---|
| **M1 企微接入** | 完成 | `wecom.controller` / `WecomClient` / 验签解密 / 群主动发送 / 单聊被动窗口 |
| **M2 触发与路由** | 完成 | 去重、@/关键词、限流、热加载 |
| **M3 上下文** | 完成 | Redis `ctx:{chat}:{user}`，轮次与 TTL |
| **M4 问答编排** | 完成 | FastGPTClient、置信度、拒答、来源；`ModelRouter` 已接入 `FastGPTQaEngine`（目录非空时选路+fallback） |
| **M5 未命中** | 完成 | 落库、导出 JSON/xlsx、`PATCH /admin/miss/:id`、media_type/status |
| **M6 敏感词** | 完成 | Aho-Corasick、热更新、整段替换 |
| **M7 配置** | 完成 | zod fail-fast、`/admin/config-check` |
| **M8 图片 VL + 素材外发** | 完成 | qwen-vl、asset CRUD、`[[素材:id]]` |
| **M8 语音/视频 ASR** | 部分完成 | `AsrService.prepareForAsr` 抽音轨/大小超时；关键帧未齐；文件仍引导+miss |
| **M8 图片闲聊 describe** | 骨架 | `IMAGE_CHAT_MODE` 改写提问后仍走 QA，非独立闲聊引擎 |
| **M9 授权** | 完成 | native 验签/指纹/反回放、闸门、reload；mock 不绕过格式/指纹 |
| **M9 反逆向** | 完成（增强约束级） | Dockerfile 混淆 + distroless + license-native；边界见概设 |
| **M10 历史导入** | 完成 | 8 步管线、审核、入库、回滚接口存在 |
| **M11 租户开通（dedicated）** | 完成 | provision/renew/配额/审计/监控编排主路径 |
| **M11 shared 租户** | 完成（实例级） | miss/asset/import 列 `tenant_id` + Redis `t:{id}:`；单进程多租户 ALS 仍非目标 |
| **M11 自助注册/支付/按量** | 部分完成 | `billing_order` 持久化 + mock 支付 sandbox；真实微信/支付宝 SDK 仍未接 |
| **会话存档实时接入** | 部分完成 | `POST /admin/archive/ingest` → `ImportJobService.createFromFile`；企微存档 SDK/拉取仍未接 |
| **在线质检** | 骨架 | 规则函数有，无持久审计/告警闭环 |
| **学习闭环自动化** | 部分完成 | 建议答案 + 审核队列 + `learning_audit` + LearningPage；聚类自动化仍可加深 |
| **多模型路由** | 完成 | `FastGPTQaEngine` 经 `ModelRouterService.pick` / `pickFallback`；跳过 unhealthy |
| **GPU 集群调度** | 部分完成 | 注册 + 定时/手动 probe + unhealthy 跳过；无 k8s/swarm provisioner |
| **LoRA 微调任务** | 部分完成 | `finetune_job` 表 + create/list/status/complete→catalog；训练执行仍外部 |
| **数据看板 / RBAC / 知识代理** | 部分完成 | `/admin/stats`、operator/admin、`/admin/knowledge/*`、admin-web 页；角色体系非用户表，双账号 env |
| **Prometheus 指标** | 完成（可选） | `METRICS_ENABLED` + `/metrics` + CIDR；access log 降噪 |

---

## 2. 架构硬规则 R-1～R-8

| 规则 | 状态 | 说明 |
|---|---|---|
| R-1 企微只经 WecomClient | 完成 | 含素材外发 |
| R-2 FastGPT 只经 FastGPTClient | 完成 | 知识代理亦走此客户端 |
| R-3 动态出站过 filter | 完成 | 固定话术/素材标题例外 |
| R-4 授权闸门入口 | 完成 | 受限模式不进 QA |
| R-5 ConfigService + env | 完成 | |
| R-6 素材/import/license 路径 | 完成 | |
| R-7 不直连 FastGPT Mongo/pgvector | 完成 | |
| R-8 导入不抢问答 | 完成 | 单并发/暂挂设计在 import |

---

## 3. 交付与运维（概设/部署手册）

| 项 | 状态 | 说明 |
|---|---|---|
| 客户部署包 + setup/install | 完成 | `cs-bot-deploy`，含镜像 |
| Let's Encrypt 步骤 | 完成 | `issue-letsencrypt.sh` + setup 步骤 6 |
| SHA256SUMS / 强口令预检 | 完成 | |
| SaaS 控制面独立进程 | 完成 | `control-plane-main` |
| 通配域 + SNI 自动签证书 | 部分完成 | `PLATFORM_TLS_MODE=wildcard` + `WildcardCertificateProvider` + SNI server_name；ACME 自动签仍可加深 |
| 每租户指纹真实采集再签 | 部分完成 | 优先 `tenant.fingerprint`，否则全局 env；开通后自动回采再签未闭环 |

---

## 4. 前端运营台（admin-web）

| 页/能力 | 状态 |
|---|---|
| 未命中 / 素材 / 导入 / 授权 / 配置 | 完成 |
| 看板 Dashboard | 完成（调 stats API） |
| 知识库代理页 | 完成（调 knowledge API） |
| 学习闭环运营页 | 完成（LearningPage + 审核/审计 API） |
| 存档/质检页 | 未做 |
| 自助注册/支付页 | 未做（半公开 API 骨架） |
| 平台租户列表/审计 | 完成（控制面 surface） |

---

## 5. 建议补齐优先级（若要以概设验收）

### P0 — 宣称「一期全量」前必须从骨架做到可验收

1. ~~会话存档：规范化 → 真正入 `import` 任务~~（admin ingest 已接；企微 SDK 拉取仍 P1）  
2. ~~shared 租户：数据面 `TENANT_ID` 贯穿 miss/asset/import/redis key~~  
3. ~~多模型路由：接入 FastGPT 通道失败 fallback~~  
4. ~~自助计费：订单表持久化 + mock 支付沙箱 + renew 审计~~（真实支付 SDK 仍 P1） 

### P1 — 体验与运营闭环

5. ~~学习闭环：建议答案 + 审核队列 + 审计页~~（已归档 `2026-11-04-p1-ops-learning-asr`）  
6. ~~视频 ASR：抽音轨、超时/大小、失败 miss~~  
7. ~~知识/看板：联调验收用例~~ 

### P2 — 平台增强（可单独立项）

8. ~~GPU/vLLM 健康探测与调度后端~~（probe + skip unhealthy；非 k8s）  
9. ~~LoRA 训练任务编排~~（job 表/API/complete；训练执行仍外部）  
10. ~~Prometheus 指标导出~~  
11. ~~SaaS 通配证书 + SNI~~（wildcard 挂载；ACME 全自动仍可加深）  

`p2-platform-enhance` 已 sync/归档（`archive/2026-11-04-p2-platform-enhance`）。

---

## 6. 验收口径建议（对外话术）

- **可说**：私有化基线（群问答、未命中、素材、导入、授权、运营台基础能力）已交付；一期文档已含原二期范围。  
- **勿说**：概设/详设所列全部能力均已生产可用。  
- **对内**：P0/P1/P2 已 sync/归档。

---

## 7. 关联路径（便于跳转）

| 类型 | 路径 |
|---|---|
| 存档骨架 | `apps/adapter/src/archive/` |
| 学习 | `apps/adapter/src/learning/` |
| 计费/自助 | `apps/adapter/src/platform/billing.service.ts`, `self-serve.controller.ts` |
| 模型路由 | `apps/adapter/src/qa/model-router.service.ts` |
| GPU / LoRA | `apps/adapter/src/platform/gpu-catalog.controller.ts`, `gpu-health.service.ts`, `finetune-job.service.ts` |
| Metrics | `apps/adapter/src/health/metrics.service.ts` |
| Wildcard TLS | `apps/adapter/src/platform/certificate-provider.ts` |
| ASR | `apps/adapter/src/media/asr.service.ts`, `wecom.controller.ts` |
| openspec（已归档） | `openspec/changes/archive/2026-11-04-p2-platform-enhance/` |
| 施工单 | `.cursor/plan/p2-platform-enhance.md` |
