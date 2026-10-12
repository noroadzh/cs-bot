# 微信群智能客服机器人 MVP

> 基线 MVP 工程代码。详细业务需求见 `docs/01-售前与商务/` 与 `docs/02-产品设计/`。

## 快速启动（开发期 mock 模式）

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境
cp .env.template .env
# 编辑 .env，填入 WECHAT_* 与 FASTGPT_* 凭证
# USE_MOCK_LLM=true（默认）下不会真正调用外部服务

# 3. 启动（仅 mock 模式可用，无需启动 redis/pg）
pnpm -C apps/adapter build
USE_MOCK_LLM=true USE_MOCK_LICENSE=true node apps/adapter/dist/main.js
```

## 部署到生产

参见 `docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md`。

## 架构

```
企微回调 → wecom-controller → routing-service
  ├─ dedup
  ├─ trigger
  ├─ rate-limiter
  └─ qa-orchestrator
       ├─ context (Redis)
       ├─ qa-engine (IQAEngine: MockQaEngine | FastGPTQaEngine)
       ├─ filter (AC 自动机)
       ├─ miss (异步 PG)
       └─ media (AssetSender)
       └─ wecom-client (发回企微)
```

详细设计见 `docs/02-产品设计/详细设计-微信群智能客服机器人MVP.md`。

## 命令

| 命令 | 用途 |
|---|---|
| `pnpm -C apps/adapter build` | 编译 |
| `pnpm -C apps/adapter test` | 单元测试 |
| `pnpm -C apps/adapter test:cov` | 覆盖率 |
| `pnpm -C packages/shared build` | shared 编译 |
| `cd deploy && docker compose up -d` | 启动 6 容器 |
| `./deploy/backup.sh` | 每日备份 |

## 增项包

- A：多媒体识别与素材管理（待客户确认）
- B：历史聊天导入
- C：SaaS 控制面
- D：本地模型推理

基线不实现增项。
