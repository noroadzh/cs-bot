# Change B: License Build 集成 - Proposal

## Why

`packages/license-native` 的 Rust 模块（change A）已能产出 `prebuilds/linux-x64-gnu/index.node`，
但 **`apps/adapter` 端尚未将其集成**：

- `apps/adapter/package.json` **未声明** `@cs-bot/license-native` 依赖
- `NativeLicenseVerifier` 是占位实现，无视返回值一律返回 `native-placeholder`（`valid: true`）
- 即使 Rust 模块被 require 进来，**启动期未做完整性自检**，被篡改/被 strip 失败的 .node 仍能启动
- `mock-license.verifier.ts` **不验签**也**不绑 fingerprint**——任何 `license.lic` 都通过
- 当前的"启动强校验"=零。**生产实际未对 license 实施任何强约束**。

**Need**：把 native 模块的 4 个 N-API 函数（`verify` / `fingerprint` / `antireplay` / `selfcheck`）串入
LicenseService 启动路径，并在 mock 模式下做同等力度的"mock 强校验"，使整个系统的
"无 license = 拒绝服务"语义可被验证（而非仅在文档里说）。

## What Changes

### B.1 package.json 依赖
- `apps/adapter/package.json` 添加 `"@cs-bot/license-native": "workspace:*"` 到 dependencies
- `pnpm install` 后 `node_modules/@cs-bot/license-native/prebuilds/linux-x64-gnu/index.node` 可用

### B.2 NativeLicenseVerifier 重写
- `require('@cs-bot/license-native')` 加载 native 模块
- **启动期 `selfcheck()` 必跑一次**：`clean: false` → 进程 exit 1 并打印 `evidence[]`
- `verify()` 调用 native `verify(payloadJson, sigB64)`，把结果映射为 `LicenseState`
- 维护内存级反回放缓存：每次 `verify()` 后调用 `antireplay(statePath, nowMs)`
  - `statePath` 使用 `license/.antireplay.json`（与 license.lic 同目录，进程独占）
  - 状态文件用 `fsync` + 0600 模式写

### B.3 fingerprint 绑定
- `fingerprint()` 在 LicenseService 启动时调用一次
- 缓存 `expectedFingerprint`，`verify()` 内部 native 已拒空指纹，TS 侧再比对：
  ```ts
  if (state.fingerprint !== this.expectedFingerprint) → reason: 'fingerprint-mismatch'
  ```
- mock 模式下也用此逻辑（保证 mock↔native 行为一致）

### B.4 mock-license.verifier.ts 强校验化
当前 mock 完全不验签。本次改为：
- 仍然不验签（mock 模式就允许乱填），但**必须做格式校验**：
  - 文件存在 + base64+JSON 解析成功 + 含 `expiresAt/fingerprint/maxChats` → valid
  - 任一字段缺失/格式错 → reason: 'malformed', valid: **false**（不再 valid:true）
  - 文件不存在 → reason: 'mock-no-license', valid: **false**（不再 valid:true）
- 这与 `USE_MOCK_LICENSE=true` 语义重新对齐：**mock 是"无 license 服务"**，不是"任意 license 通过"

### B.5 LicenseService 启动序
```
AppModule.onModuleInit
  → licenseService.startupCheck()
      1. fingerprint()         # 缓存宿主指纹
      2. selfcheck()           # 反调试/反注入；失败 exit 1
      3. verifyAndCache()      # 验 license + antireplay
      4. 若 !valid → 进程 exit 1（生产）| warn（dev）
```
当前逻辑：仅 `verifyAndCache()` 在 `onModuleInit` 里跑，无 `selfcheck`、无 `fingerprint` 缓存、
mock 模式永远 `valid: true`。

### B.6 测试策略
- 改 `license.service.spec.ts` 覆盖 startupCheck 4 步
- 改 `mock-license.verifier.spec.ts` 覆盖新"强校验"路径
- 改 `native-license.verifier.spec.ts` mock napi 模块，验 4 步编排
- 改 `license.guard.spec.ts` 覆盖 fingerprint mismatch 路径
- 目标覆盖率 ≥ 75%（与 5.1/5.2 门禁一致）

### B.7 Spec 增量
- `openspec/specs/license-skeleton/spec.md` 新增 `M9-Bind-Integration` requirement
- 含 4 个 Scenario：
  - 启动期 selfcheck 失败 → 进程退出
  - 启动期 fingerprint 采集成功 → 缓存
  - mock 模式 license 缺失 → 返回 invalid（不再 valid:true）
  - fingerprint 不匹配 → reason: fingerprint-mismatch

## Non-Goals

- **不**实现 `ts:license` 工具（change C：license-bind 提供 issuer / sign 命令）
- **不**改动 Dockerfile（change C 仍负责 issuer + 容器化现编）
- **不**做 license 远程签发/吊销（mock 模式无服务端）
- **不**实现 license 文件加密（payload 明文 JSON 即可；签名是完整性保证）

## Impact

- 行为变更（**breaking** for 现有 dev 流）：
  - `USE_MOCK_LICENSE=true` **不再让无 license 通过**——必须有 `license/license.lic`（或 mock 接受的有效负载）
  - `license/license.lic` 缺失时启动 warn 但**不**exit（仅 mock 模式），生产模式直接 exit 1
- 受影响 spec：`license-skeleton/M9`
- 配合 change A（native 模块）、change C（Dockerfile + issuer）形成完整 license 闭环
