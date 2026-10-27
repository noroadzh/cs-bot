# Tasks

## 1. Mock 全栈 harness

- [ ] 1.1 起 harness：真实 adapter（in-process）+ 本地 PG（postgres:16）+ ioredis-mock + FastGPT HTTP mock + 企微签名 mock
- [ ] 1.2 FastGPT mock server（命中高分 / 低分拒答 / 超时-5xx 降级三态）与企微回调签名工具（复用 wecom-crypto 向量）

## 2. 集成用例

- [ ] 2.1 正常问答全链路（回调→触发→上下文→QA→置信度→过滤→回复）
- [ ] 2.2 低置信拒答 + miss_record；去重；限流；授权受限模式；图片识别失败引导
- [ ] 2.3 断言 HTTP 响应 + DB（miss_record / usage）

## 3. ab 压测

- [ ] 3.1 ab 脚本打 `/wecom/callback`（签名 mock）：P95 ≤ 8s、吞吐、错误率
- [ ] 3.2 限流验证（单群 20/min、单人 5/min）与去重幂等
- [ ] 3.3 报告产物（JSON/文本）写入 `artifacts/`

## 4. 运行与 CI

- [ ] 4.1 `test:acceptance` 脚本（mock 全栈 + 用例 + 压测 + 报告）
- [ ] 4.2 CI acceptance job（mock 默认）；真实 6 容器 nightly/有网，可跳过
- [ ] 4.3 可选真实 compose 冒烟：无网络时跳过而不失败

## 5. 验证

- [ ] 5.1 本机一键跑通 mock 全栈 + ab 压测并产出报告；`openspec validate add-acceptance-tests --strict` 通过
