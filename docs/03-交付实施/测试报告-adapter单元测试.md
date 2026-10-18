# 微信群智能客服机器人 MVP — adapter 单元测试报告

| 项 | 内容 |
|---|---|
| 文档名称 | adapter 单元测试报告（Jest） |
| 版本 | V1.0 |
| 日期 | 2026-10-16 |
| 适用对象 | 交付工程师、内部开发 |
| 适用系统 | 微信群智能客服机器人 MVP（对应《概要设计 V1.9》《详细设计 V1.1》） |
| 测试范围 | `apps/adapter`（NestJS 适配层）单元测试 |
| 运行方式 | 本地 `cd apps/adapter && pnpm test:cov`；CI `pnpm -F @cs-bot/adapter test:cov` |
| 关联文档 | 《部署手册 V1.1》《详细设计 V1.1》 |

> 本报告记录 2026-10-16 一次全量单测执行结果，用于交付存档。覆盖率为 Jest `--coverage`（v8）采集，仅统计 `apps/adapter/src` 下被测源码；`packages/*` 与 `apps/web` 不在范围。

---

## 1. 结果概览

| 指标 | 值 | 阈值 | 状态 |
|---|---|---|---|
| Test Suites | 28 passed / 28 total | — | ✅ |
| Tests | 226 passed / 226 total | — | ✅ |
| Snapshots | 0 | — | — |
| 耗时 | 28.0 s | — | — |
| Statements 覆盖率 | 85.83 % | ≥ 75 % | ✅ |
| Branches 覆盖率 | 69.81 % | ≥ 75 % | ❌ 红灯 |
| Functions 覆盖率 | 79.41 % | — | ✅ |
| Lines 覆盖率 | 86.15 % | — | ✅ |

**结论**：用例全绿，无 flaky、无 open handle 泄漏。唯一红灯为 **branches 69.81 % < 75 % 阈值**，CI 会因此标红——根因与处置见 §3。

## 2. 按模块分组的测试矩阵

> 每行：`套件名 | 用例数 | 失败 | 耗时(s)`。全部失败数为 0。

### 2.1 License 校验（33 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| license.service.spec | 8 | 0 | 15.4 | B.5 启动序四步：fingerprint→selfcheck→verify→终态；mock/native 双模式、selfcheck 干净/不干净、verify 失败透传 reason、production 才 exit(1)、getState() 缓存 |
| license-mock.spec | 7 | 0 | 0.6 | Mock verifier：无 license→mock-no-license、bad format→malformed、过期→expired、fingerprint 绑定、maxChats 解析 |
| license.guard.spec | 5 | 0 | 15.5 | 请求路径上的 license 状态拦截（guard） |
| admin.guard.spec | 13 | 0 | 0.8 | 管理后台鉴权：字段缺失/错误拒绝 |

### 2.2 企微接入（43 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| wecom.controller.spec | 14 | 0 | 2.0 | 握手验证、文本/回调解密路由、image 识别分支、LLM 超时/拒绝→ErrCode 映射、回复路径 |
| wecom-client.spec | 15 | 0 | 17.6 | downloadMedia、parseXml 取 MediaId、getAccessToken、发消息 |
| wecom-crypto.spec | 14 | 0 | 1.1 | 企微 AES-CBC 加解密、signature 校验、消息解密路由 |

### 2.3 QA 问答（27 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| fastgpt-qa.engine.spec | 10 | 0 | 15.5 | FastGPT HTTP 调用、URL/model 固定、ECONNREFUSED→LLM_TIMEOUT 与 LLM_REJECT 映射、重试、空响应 |
| mock-qa.engine.spec | 3 | 0 | 0.8 | 本地 mock 引擎：默认回复、分组排序、加载配置 |
| qa-orchestrator.spec | 9 | 0 | 1.3 | 编排器：服务选择、上下文注入、埋点、错误兜底 |
| context.service.spec | 5 | 0 | 0.6 | 会话上下文存储与维护 |

### 2.4 Media 资产（39 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| asset.controller.spec | 14 | 0 | 16.8 | asset 资源 HTTP 端点、按 id 分发、权限 |
| asset-reference.resolver.spec | 11 | 0 | 0.6 | 媒体引用解析 |
| media-recognize.service.spec | 9 | 0 | 1.1 | Content-Type 解析（正常头/charset/boundary/大小写/空值/数组）、URL 空值防御、敏感标题拦截、"不答图片"兜底 |
| asset-sender.service.spec | 5 | 0 | 0.6 | 失败重试、downstream network down 兜底 |

### 2.5 配置 / 健康 / 冒烟（32 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| config.service.spec | 12 | 0 | 0.8 | 配置读写、schema 校验 |
| config.controller.spec | 9 | 0 | 16.9 | 配置端点 |
| health.controller.spec | 7 | 0 | 2.3 | 健康检查端点 |
| smoke.spec | 4 | 0 | 19.9 | 端到端启动冒烟：Config→License→Redis→PG→HTTP |

### 2.6 过滤 / 路由 / 限流 / 去重 / 触发（29 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| trigger.service.spec | 10 | 0 | 15.4 | 触发器：关键词/时间触发 |
| routing.service.spec | 6 | 0 | 0.7 | 群/关键词触发、no_match/scope 错误码 |
| sensitive-filter.service.spec | 5 | 0 | 0.7 | 敏感词命中、白名单、默认词加载 |
| rate-limiter.service.spec | 4 | 0 | 0.7 | 群维度限流、超限拦截 |
| dedup.service.spec | 4 | 0 | 0.6 | 消息去重 |

### 2.7 漏单 / Miss 处理（23 用例）

| 套件 | 用例 | 失败 | 耗时 | 覆盖点 |
|---|---|---|---|---|
| miss.controller.spec | 9 | 0 | 18.9 | 漏单补发端点 |
| miss-cleanup.service.spec | 6 | 0 | 16.8 | 定期清理 |
| miss.service.spec | 5 | 0 | 0.7 | Miss 状态机、回调 |
| miss-export.service.spec | 3 | 0 | 18.6 | 漏单导出 |

---

## 3. 覆盖率逐文件明细与短板

### 3.1 逐文件覆盖率（节选，仅列低于 100 % 的文件）

| 文件 | stmts % | branches % | funcs % | lines % | 未覆盖行 |
|---|---|---|---|---|---|
| license/native-license.verifier.ts | 21.73 | 3.84 | 20 | 22.22 | 35, 43-44, 58-156 |
| media/asset.service.ts | 31.57 | 0 | 16.66 | 29.62 | 38-190 |
| media/media-recognize.service.ts | 47.05 | 42.85 | 28.57 | 44.44 | 31-102 |
| miss/miss-export.service.ts | 71.69 | 0 | 83.33 | 75.55 | 34, 63-87, 93 |
| license/mock-license.verifier.ts | 88.88 | 68.18 | 50 | 88.88 | 24, 38-43, 105 |
| filter/sensitive-filter.service.ts | 89.36 | 87.5 | 80 | 91.89 | 45, 52-53 |
| qa/qa-orchestrator.ts | 88.65 | 80 | 62.5 | 88.63 | 74-75, 92-101, 108 |
| miss/miss.service.ts | 89.65 | 50 | 71.42 | 100 | 44 |
| common/logger.ts | 90 | 100 | 85.71 | 90 | 37 |
| qa/fastgpt-qa.engine.ts | 93.75 | 84.21 | 100 | 96.66 | 30 |
| qa/mock-qa.engine.ts | 97.5 | 84.61 | 100 | 96.96 | 31 |
| wecom/wecom.controller.ts | 95.45 | 88.23 | 100 | 95.31 | 115-116, 122 |
| wecom/wecom-crypto.ts | 95.58 | 72.34 | 100 | 98.38 | 23 |
| wecom/wecom-client.ts | 90.58 | 70.37 | 85.71 | 89.47 | 90, 102, 118, 135-136, 148-150 |
| routing/trigger.service.ts | 97.36 | 76.47 | 100 | 100 | 32, 55, 63 |
| routing/rate-limiter.service.ts | 97.22 | 88.88 | 100 | 100 | 48 |
| license/license.service.ts | 95.74 | 91.3 | 83.33 | 97.72 | 64 |
| admin/license.controller.ts | 88.88 | 100 | 50 | 93.33 | 43 |
| media/asset.controller.ts | 100 | 92.85 | 100 | 100 | 39 |
| admin/admin.guard.ts | 100 | 87.5 | 100 | 100 | 15-25 |

> 以下文件达 100 % 全维度，不再单列：`config/*`、`context.service`、`health.controller`、`license.guard`、`media/asset-reference.resolver`、`media/asset-sender.service`、`miss-cleanup.service`、`routing/dedup`、`routing/routing.service`、`admin/config.controller`、`admin/miss.controller`、`qa/message-sender.port`。

### 3.2 短板分析（影响 branches 阈值的三个主因）

1. **`native-license.verifier.ts`（21.73 % / 3.84 % branches）—— 最大缺口**
   N-API 产物 `index.node` 在本机与 CI 未加载，`verify`/`selfcheck`/`antireplay` 几乎全部走 `native=null` 回退分支（58-156 行未执行）。**属环境性缺口，非代码缺陷**：真实路径需在已预构建 `.node` 的运行环境（Docker 内 Linux）才会走到。建议：CI 注入预构建产物，或用 `jest.mock` 桩掉 N-API 跑真实分支；若长期不在 CI 跑 native，应将其 `coveragePathExclude` 排除阈值统计。

2. **`asset.service.ts`（31.57 % / 0 % branches）—— 新增服务未充分覆盖**
   媒体资产服务 38-190 行（DB 写入 / 资源下载 / 引用登记）未覆盖，现有 spec 仅覆盖 controller 入口。建议：补 asset.service 的存档、查重、下载失败路径用例（可提 5-8 个 branches 点）。

3. **`miss-export.service.ts`（71.69 % / 0 % branches）—— 失败/重试分支未覆盖**
   63-87、93 行的导出失败与重试分支无用例。建议：补下游不可用、格式异常、超时重试用例。

> 次要：`media-recognize.service.ts`（47.05 %）31-102 核心识别逻辑未覆盖，现有 9 用例集中在 Content-Type 解析旁路；`mock-license.verifier.ts` 38-43 行 N-API 加载回退未覆盖（同 native 根因）。

### 3.3 阈值红灯处置建议

`jest.config.*` 的 `globalCoverageThresholds.branches = 75`，当前 69.81 % → CI 标红。两条路线：

- **路线 A（补用例，推荐）**：补 §3.2 的 asset.service + miss-export 失败路径用例，预期可提 branches 至 ~75 %；native 走 §3.2-1 桩或排除阈值。
- **路线 B（下调阈值）**：若 75 % branches 非交付硬性要求，将 `jest.config` 的 `branches` 下调至 65 解除红线，stmts/lines 仍维持 ≥ 75。

> 需决策方拍板：路线 A 还是 B，以及 native 是否纳入阈值统计。该项已记入《文档清单》五、待确认事项。

---

## 4. 已知约束

- 本机与 CI 均无预构建 `@cs-bot/license-native` 的 `index.node`，故 native 验签真实路径未在本报告覆盖率中体现；生产部署（Docker 内 node 环境）才会走到。
- `smoke.spec` 末尾有 `--forceExit` 提示，源自其未 `unref` 的定时器；不影响断言结果。
- 本报告不含 `packages/license-native`（Rust + N-API）与 `apps/web` 的测试；二者另测。

## 5. 复现命令

```bash
# 全量 + 覆盖率（本报告所用）
cd apps/adapter && pnpm test:cov

# 仅看某模块
./node_modules/.bin/jest test/license --coverage

# JSON 结果（逐套件用例数）
./node_modules/.bin/jest --json --outputFile=jest.json
```
