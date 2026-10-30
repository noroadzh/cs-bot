# Proposal

## Why

第二十二轮复核发现详设 §3.9 R-8 把导入队列写成「进程内 BullMQ-lite」、内存超限「暂挂 5min」，实际是自研 `ImportTaskQueue`（单消费者），超阈值时每 5 秒轮询、恢复后立即继续，且阈值同时考虑增量 >200MB。

## What Changes

- 详设 §3.9 R-8 改为实际：`ImportTaskQueue`（进程内 FIFO + 单消费者）；每批后检查「增量 >200MB 或 RSS >80% 限额」，超阈值每 5s 轮询、恢复后继续。
- 版本：详设 V1.16。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

（无。仅文档修订，`skip_specs: true`。）

## Impact

- **文档**：详细设计、文档清单与交叉引用。
- **代码/规格/测试**：无改动。
