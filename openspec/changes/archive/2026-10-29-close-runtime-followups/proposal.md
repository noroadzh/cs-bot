# Proposal

## Why

第二轮完整性复核（`openspec/explorations/2026-10-28-design-completeness-recheck-2.md`）发现：主链路已完整，但容量配额只存储不执行、运维手册命令在 ReasonGuard 下会 400、异步导入内存基线未重置，另有审计词表、租户升级通知、异地留存、容量统计与姓名脱敏覆盖等 5 项 P2。它们不影响问答主链路，但会让运营配置与合规承诺落空。

## What Changes

### P1

- **容量配额执行**：`maxDocs/maxQa/maxAssetMb` 从“只存”变为可执行——资产上传前校验素材容量，导入确认前校验 QA/文档增量；超限拒绝并返回明确错误，外部 FastGPT 后台写入仍由运营流程约束。
- **异步导入基线**：`startParse` 后台任务结束时重置内存基线，避免后续任务沿用旧基线误暂停/漏暂停。
- **运维手册 reason**：`secrets/provision/restart/credentials handoff` 等平台变更命令补充 `reason`（body 或 `X-Operator-Reason`），确保按手册执行不会 400。

### P2

- **审计词表**：将 `tenant.credentials` 纳入固定 action 词表；新增“审计异地留存”要求——180 天清理前必须先成功导出到配置的异地目标，导出失败则保留本地行。
- **租户升级通知**：升级通知直接触达租户联系人（复用邮件 webhook），不再只提示运维转达；无联系人时回退运维通道并记录。
- **容量统计可靠性**：`docCount` 改为从租户 FastGPT MongoDB 统计（与导出同源），查询失败时上报错误并重试，不以 0 静默代替。
- **姓名脱敏覆盖**：在现有“姓名/联系人/收货人”标签基础上增加 `config/import-names.txt` 词典匹配，覆盖无标签姓名；词典缺失时保持标签匹配。

### Out of Scope

- grace 期 FastGPT 后台只读仍由外部配置约束；群聊被动回复、UI/mTLS、控制面独立目录、5.4 真实多租户 UAT 维持既有记录。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `tenant-quota`：新增容量配额执行要求（素材/QA/文档）。
- `platform-audit`：动作词表补充 `tenant.credentials`；新增异地留存要求。
- `tenant-upgrade`：升级通知直接触达租户。
- `usage-reporting`：容量统计失败可见与重试。
- `import-review`：姓名脱敏覆盖词典匹配。

## Impact

- **代码**：`tenant-gate.service.ts`/`tenant-quota.service.ts`（容量校验）、`asset.service.ts`、`import-confirm.ts`、`import-job.service.ts`（基线）、`platform-audit.service.ts`、`upgrade-runner.ts`、`capacity-usage.service.ts`、`sensitive-redactor.ts`。
- **配置**：`config/import-names.txt`、异地审计导出目标、租户联系人通道。
- **文档**：部署手册平台命令统一带 reason；审计留存流程；容量配额说明。
- **API**：超配额返回码（素材上传/导入确认）；其余路径不变。
