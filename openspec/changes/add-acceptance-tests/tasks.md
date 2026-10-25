# Tasks

## 1. 全栈编排

- [ ] 1.1 新增 acceptance compose profile / 编排脚本：起 nginx/adapter/fastgpt/pg/mongo/redis 6 容器并等待健康
- [ ] 1.2 企微回调签名 mock 与 FastGPT 通道配置（真实/mock 切换）

## 2. 集成用例

- [ ] 2.1 正常问答全链路（回调→触发→上下文→FastGPT→置信度→过滤→回复）
- [ ] 2.2 低置信拒答 + miss_record；去重；限流；授权受限模式；图片识别失败引导
- [ ] 2.3 断言端到端可观测结果（回复文本/miss_record/usage）

## 3. 压测

- [ ] 3.1 autocannon/k6 脚本：P95 ≤ 8s、吞吐、错误率
- [ ] 3.2 限流验证（单群 20/min、单人 5/min）与去重幂等
- [ ] 3.3 报告产物（JSON/HTML）写入 `artifacts/`

## 4. 运行与 CI

- [ ] 4.1 `test:acceptance` 脚本（编排 + 用例 + 压测 + 报告）
- [ ] 4.2 CI acceptance job（nightly/手动），失败阻断；文档说明环境要求

## 5. 验证

- [ ] 5.1 干净环境一键跑通并产出报告；`openspec validate add-acceptance-tests --strict` 通过
