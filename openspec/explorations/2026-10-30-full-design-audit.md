# 概要/详细设计全量核对（2026-10-30，一次性覆盖全部章节）

## 范围

逐节核对概设 V1.26（§1–§13，905 行）与详设 V1.16（§1–§10，521 行），对照代码、迁移、规格与测试。

## 结论

- **功能缺陷 1 项**（已修复）：空引用答案按 0.8 命中，违反 `qa-orchestration`「空 quotes → 0」与 ADR A4。
- **文档偏差 15 项**（已修复）：选型版本、被动回复残留、素材/脱敏/订阅扫描/构建管线等。

## 功能缺陷

| # | 问题 | 证据 | 修复 |
|---|---|---|---|
| 1 | 无 quoteList 且无 `data[0].score` 时 score 默认 0.8，≥0.75 阈值被当命中，不记 miss、不拒答 | `fastgpt.client.ts:172`、`fastgpt-qa.engine.ts:204` 原为 `?? 0.8`；规格 `qa-orchestration`「Confidence threshold rejection」要求空 quotes → 0；ADR A4「宁可拒答不可编造」 | 两处改为 `?? 0`；更新 3 处旧断言；新增编排器用例（空 quotes → miss + 拒答） |

## 文档偏差与修正

概设（→ V1.27）：
1. §1 部署手册引用 V1.13→V1.14、日期 2026-10-12→2026-10-30。
2. §3.3 形态 A 补 8443 管理后台备注。
3. §4 选型表：PostgreSQL 15+schema=adapter→16+默认 schema；MongoDB 6.x→7.x；Nginx 1.25→1.27；pgvector pg15→pg16。
4. §4.3 hybrid 超时改以 `LLM_TIMEOUT_MS`（默认 15s）判定；健康探测路径 `/`；adapter 未设 CPU 硬限。
5. §10.1 adapter 去掉「CPU 1.0」；watchtower 标注未启用。
6. §8.1/§11.1/§11.4 被动回复/3.5s 表述改群聊主动发送。
7. §12 风险 3 watchtower 预案改镜像回滚/降配。
8. R-7「schema=adapter」→默认 schema。

详设（→ V1.17）：
9. §2.3 置信度空引用 0.8→0。
10. §3.1 删除 3.5s 竞速；`1001`→`WECOM_SIGN_INVALID`。
11. §3.4 拒答文案改实际 `REFUSAL_TEXT`；`LLM_ALL_FAILED`→`LLM_TIMEOUT`+告警；素材引用改 UUID。
12. §3.7 素材上传参数改 `file`/`{url,name}`；错误码改 `ASSET_SEND_FAIL`。
13. §3.8 群数上限改运行时新群准入。
14. §3.9 脱敏来源改内置正则 + `import-names.txt`；姓名改标签 + 词典。
15. §3.10 订阅扫描 03:00/`sub_expire_at` → 09:00/`expired_at`。
16. §8 控制面镜像单独构建 → 同镜像双入口。

## 验证

107 suites / 996 tests、集成 7/28、验收 6/23 全绿；残留检索无失效表述。
