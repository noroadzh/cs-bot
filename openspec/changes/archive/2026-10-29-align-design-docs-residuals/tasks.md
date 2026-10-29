# Tasks

- [x] 1.1 详设 §3.10 编排渲染描述改为 `ShellProvisioner.render()` 内联生成，修正端口/网络/库名。
- [x] 1.2 详设 §3.9 解析器改为 CSV/JSONL/TXT/XLSX 四种。
- [x] 1.3 概设 M2 限流改为按分钟固定窗口。
- [x] 1.4 概设 M8 素材标记改为 `[[素材:<uuid>]]`。
- [x] 1.5 概设 V1.11、详设 V1.3 版本记录。
- [x] 2.1 全文检索确认无 `env.hbs`、`[[素材:(\d+)]]`、`滑动窗口` 残留；`openspec validate` 通过。

## Workflow follow-up

- 完成后 `/opsx:verify align-design-docs-residuals`，通过后 `/opsx:archive`。
