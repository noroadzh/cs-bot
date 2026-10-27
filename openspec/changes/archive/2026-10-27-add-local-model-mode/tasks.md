# Tasks

## 1. 配置

- [x] 1.1 `config.schema.ts` 新增 `MODEL_MODE`、`LOCAL_LLM_BASE_URL`、`LOCAL_EMBEDDING_URL`、`LOCAL_LLM_MODEL`；local/hybrid 时 fail-fast 校验
- [x] 1.2 `.env.template` 与部署手册补本地模型字段

## 2. 模型路由

- [x] 2.1 实现 `ModelRouter`（cloud/hybrid/local 选择），spec 覆盖三档
- [x] 2.2 hybrid 本地优先 + 超时/故障切云 + 熔断冷却，记录切云次数/原因
- [x] 2.3 local 档故障回繁忙话术且无云 LLM 出站，spec 覆盖不出站

## 3. 编排集成

- [x] 3.1 `QaOrchestrator` 接入 `ModelRouter`，问答链路按 MODEL_MODE 选通道
- [x] 3.2 usage 计数记录切云次数；日志结构化

## 4. 部署配套

- [x] 4.1 `deploy/local-models-compose.yml`（vllm + xinference）+ 模型拉取/健康检查脚本
- [x] 4.2 运行手册：embedding 切换必须全量重建索引；local/hybrid 时延预期

## 5. 验证

- [x] 5.1 单测覆盖 router 三档 + 切换 + 不出站；既有全套 jest 通过
- [x] 5.2 `openspec validate add-local-model-mode --strict` 通过
