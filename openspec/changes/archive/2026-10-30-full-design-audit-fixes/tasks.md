# Tasks

## 1. 代码：空引用置信度归零

- [x] 1.1 `fastgpt.client.ts` parseChatResponse：空 quotes 且无 `data[0].score` → 0。
- [x] 1.2 `fastgpt-qa.engine.ts` 自带解析同步改为 0。
- [x] 1.3 更新 `fastgpt-client.spec.ts`、`fastgpt-qa.engine.spec.ts` 中 0.8 断言。
- [x] 1.4 新增 `qa-orchestrator.spec.ts` 用例：空 quotes → 记 miss + 拒答话术。

## 2. 概设文档

- [x] 2.1 §1 关联文档/日期；§3.3 形态 A 补 8443。
- [x] 2.2 §4 选型表版本（PG16/默认 schema、Mongo7、Nginx1.27、pgvector pg16）。
- [x] 2.3 §4.3 hybrid 超时/健康探测/CPU 表述；§10.1 adapter CPU 行与 watchtower 标注。
- [x] 2.4 §8.1/§11.1/§11.4 被动回复改主动发送；§12 风险 3 watchtower 预案。

## 3. 详设文档

- [x] 3.1 §2.3 置信度空引用 0；§3.1 去除 3.5s 竞速与旧错误码。
- [x] 3.2 §3.4 拒答文案、错误码、素材引用 UUID。
- [x] 3.3 §3.7 素材上传参数与 ASSET_* 错误码。
- [x] 3.4 §3.8 群数上限运行时准入。
- [x] 3.5 §3.9 脱敏来源（内置正则 + 姓名字典）。
- [x] 3.6 §3.10 订阅扫描 09:00/`expired_at`；§8 同镜像双入口。

## 4. 版本与验证

- [x] 4.1 版本同步（概设 V1.27 / 详设 V1.17 / 测试报告按实际计数）。
- [x] 4.2 全量单测、集成、验收通过；`openspec validate` 通过；检索无失效表述。

## Workflow follow-up

- 完成后 `/opsx:verify full-design-audit-fixes`，通过后 `/opsx:archive`。
