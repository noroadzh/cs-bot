# 微信群智能客服机器人 MVP — adapter 单元测试报告

| 项 | 内容 |
|---|---|
| 文档名称 | adapter 单元测试报告（Jest） |
| 版本 | V1.1 |
| 日期 | 2026-10-29 |
| 适用对象 | 交付工程师、内部开发 |
| 适用系统 | 微信群智能客服机器人 MVP（对应《概要设计 V1.11》《详细设计 V1.3》） |
| 测试范围 | `apps/adapter`（NestJS 适配层）单元测试 |
| 运行方式 | 本地 `cd apps/adapter && pnpm test:cov`；CI `pnpm -F @cs-bot/adapter test:cov` |
| 关联文档 | 《部署手册 V1.3》《详细设计 V1.3》 |

> 本报告记录 2026-10-29 一次全量单测执行结果，用于交付存档。覆盖率为 Jest `--coverage`（v8）采集，仅统计 `apps/adapter/src` 下被测源码；`packages/*` 与 `apps/web` 不在范围。集成/验收套件需真实 PG，按环境条件跳过，单独执行（见 §1.1）。

---

## 1. 结果概览

| 指标 | 值 | 阈值 | 状态 |
|---|---|---|---|
| Test Suites | 98 passed / 112 total（14 个集成/验收套件按条件跳过） | — | ✅ |
| Tests | 946 passed / 999 total（53 skipped） | — | ✅ |
| Snapshots | 0 | — | — |
| 耗时 | 43.7 s | — | — |
| Statements 覆盖率 | 94.44 % | ≥ 75 % | ✅ |
| Branches 覆盖率 | 81.66 % | ≥ 75 % | ✅ |
| Functions 覆盖率 | 90.84 % | — | ✅ |
| Lines 覆盖率 | 95.47 % | ≥ 75 % | ✅ |

**结论**：单测全绿，四项覆盖率均达标（branches 81.66 % ≥ 75 %）。

### 1.1 集成 / 验收（独立执行）

| 类型 | 命令 | 结果 |
|---|---|---|
| 集成（真实 PG） | `TEST_PG_URL=postgresql://cs:cs@127.0.0.1:55432/csbot_test npx jest test/integration --runInBand` | 7 suites / 28 tests 通过 |
| 验收 | `TEST_PG_URL=… npx jest test/acceptance --runInBand --forceExit` | 6 suites / 23 tests 通过 |

## 2. 按模块分组的通过用例

> 句末数字为「通过套件数 / 通过用例数」。集成与验收套件未计入下表。

| 模块 | 套件 / 用例 | 主要覆盖点 |
|---|---|---|
| 平台控制面（M11） | 25 / 249 | 租户 CRUD/配额/状态机、订阅扫描、注销、审计链与异地留存、升级窗口与通知、证书/签发、compose 编排、监控、容量守卫与上报 |
| 历史导入（M10） | 16 / 176 | 四种格式解析、流式、配对、脱敏、审核、入库/回滚、清理、内存暂挂、任务队列 |
| 管理/配置/健康 | 8 / 98 | Admin 鉴权、config-check/reload、healthz、Swagger 契约、启动冒烟 |
| 多媒体（M8） | 8 / 76 | 素材上传/列表/删除、引用解析、素材外发、qwen-vl 识别与降级 |
| 授权（M9） | 11 / 69 | 验签/指纹/回拨、mock/native、群数上限、运行期复核、告警 |
| 企微接入（M1） | 3 / 64 | 回调验签/AES、消息解析、token 缓存、媒体上传下载、发送重试 |
| 交付/打包 | 6 / 56 | compose 拆分边界、迁移完整性、backup、交付包白名单、镜像加固 |
| 问答（M4） | 6 / 52 | FastGPT 调用与重试、模型通道、置信度、上下文、问题归一 |
| 路由/过滤（M2/M6） | 7 / 49 | 触发词、限流、去重、敏感词热加载 |
| 未命中（M5） | 4 / 34 | 落库、查询、xlsx 导出、90 天清理 |
| 可观测性 | 2 / 8 | 结构化日志、PII 脱敏 |
| 其他 | 1 / 8 | 跨模块工具 |
| 会话上下文（M3） | 1 / 6 | 5 轮截断、TTL、Redis 故障 fail-open |

## 3. 覆盖率短板

> 以下按 lines 升序列出低于 95 % 的文件（其余文件 lines ≥ 95 %，多数为 100 %）。

| 文件 | stmts % | branches % | funcs % | lines % | 说明 |
|---|---|---|---|---|---|
| common/http-logging.middleware.ts | 0 | 0 | 0 | 0 | 仅在 `main.ts` 装配，单测未直接覆盖；由镜像/冒烟路径间接体现 |
| license/license.service.ts | 84.75 | 81.48 | 75 | 85.96 | native 分支的 selfcheck 透传细节 |
| license/native-license.verifier.ts | 86.96 | 65.38 | 100 | 88.89 | 无 `index.node` 环境的回退路径，生产镜像才触发 |
| license/mock-license.verifier.ts | 88.89 | 68.18 | 50 | 88.89 | mock 边界分支 |
| qa/qa-orchestrator.ts | 90.76 | 84.00 | 75 | 90.74 | 降级/埋点分支 |
| filter/sensitive-filter.service.ts | 88.64 | 87.50 | 80 | 91.18 | `fs.watch` 回调分支 |
| qa/fastgpt-qa.engine.ts | 90.10 | 77.22 | 86.67 | 93.18 | 网络异常与重试分支 |
| wecom/wecom.controller.ts | 93.98 | 84.75 | 100 | 93.80 | image 识别/用量埋点异常降级 |
| admin/license.controller.ts | 89.47 | 100 | 50 | 93.75 | 错误分支 |
| config/config.schema.ts | 87.50 | 88.89 | 100 | 87.50 | 环境变量解析边界 |
| common/client-ip.ts | 92.75 | 67.50 | 100 | 100 | 可信代理网段分支 |
| common/request-context.ts | 92.86 | 40.00 | 100 | 100 | AsyncLocalStorage 缺省分支 |
| wecom/wecom-crypto.ts | 95.77 | 74.14 | 100 | 98.46 | 异常签名分支 |
| routing/routing.service.ts | 95.52 | 76.19 | 83.33 | 95.16 | 授权拦截分支 |

均在阈值之上，不影响门禁；后续补测优先 `http-logging.middleware` 与 native 回退路径。

## 4. 已知约束

- 本机与 CI 未预构建 `@cs-bot/license-native` 的 `index.node`，native 验签真实路径不在单测覆盖率中；生产镜像内才会走到。
- 集成/验收套件依赖真实 PostgreSQL（`TEST_PG_URL`），默认单测运行按条件跳过。
- 本报告不含 `packages/license-native`（Rust + N-API）与 `apps/web`；二者另测。
- 单测中存在 2 个条件跳过的用例（依赖环境开关）。

## 5. 复现命令

```bash
# 全量单测 + 覆盖率（本报告所用）
cd apps/adapter && npx jest --coverage --maxWorkers=4

# 集成 / 验收（需真实 PG）
TEST_PG_URL=postgresql://cs:cs@127.0.0.1:55432/csbot_test npx jest test/integration --runInBand
TEST_PG_URL=… npx jest test/acceptance --runInBand --forceExit

# 仅看某模块
npx jest test/license --coverage

# JSON 结果（逐套件用例数）
npx jest --json --outputFile=jest.json
```
