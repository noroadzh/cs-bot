# Change B: License Build 集成 - Tasks

## Task 详情

### B.1 依赖接入

- [x] `apps/adapter/package.json` 添加 `"@cs-bot/license-native": "workspace:*"`
- [x] `pnpm install` 成功，`node_modules/@cs-bot/license-native` 软链正确
- [x] 确认 `packages/license-native` 的 `main` 指向 `prebuilds/linux-x64-gnu/index.node`

### B.2 NativeLicenseVerifier 重写

- [x] `createRequire(import.meta.url)` 加载 native 模块（macOS 加载应成功，仅 fingerprint() 调用失败）
- [x] 构造器中执行 `selfcheck()`，`clean: false` → log evidence + `process.exit(1)`（/proc 读不到时跳过 tracer 项即可）
- [x] 构造器中执行 `fingerprint()`，**成功才缓存** `expectedFingerprint`；失败（macOS）→ warn 跳过绑定
- [x] 读取 license 文件 split('.') 切分；非 2 段 → `{valid:false, reason:'malformed'}`
- [x] `parts[0]` base64 解码得到 JSON 原文，**整体传入 native.verify(jsonStr, sigB64)**
- [x] native result.valid=false → reason 映射 `'expired'→'expired'`、其他 → `'malformed'`
- [x] **TS 侧** `JSON.parse(jsonStr).fingerprint !== this.expectedFingerprint` → `reason:'fingerprint-mismatch'`
- [x] native `antireplay(statePath, Date.now())` `ok:false` → `reason:'antireplay-rollback'`
- [x] result.expires_at_ms 转为 ISO 字符串（`new Date(ms).toISOString()`），daysLeft 计算
- [x] 移除 `native-placeholder` 兜底分支

### B.2.1 LicenseState reason 封闭联合扩展

- [x] `apps/adapter/src/license/license.types.ts` 的 `LicenseState.reason` 增加 `'fingerprint-mismatch' | 'antireplay-rollback' | 'mock-no-license'`
- [x] 同步更新既有 `mock-license.verifier.ts` 的所有 `reason` 字段以通过新联合的 TS 检查

### B.3 fingerprint 绑定（mock 侧）

- [x] `MockLicenseVerifier` 读取 payload **snake_case** 字段：`fingerprint`（优先）/ `deviceId`、`expires_at_ms`（优先）/ `expiresAt`、`max_chats` / `maxChats`
- [x] 构造器尝试 `native.fingerprint()`（容错：失败则跳过绑定，仅 warn）
- [x] `verify()` 返回后与 `expectedFingerprint` 比对（仅当两边都存在）
- [x] 不匹配 → `reason:'fingerprint-mismatch', valid:false`
- [x] 确认 mock 模式仍不验签（保持 SPEC：mock 只 stub 签名，不 stub 绑定）

### B.4 Mock 强校验

- [x] license 文件不存在 → `{valid: false, reason: 'mock-no-license', mock: true}`
- [x] 格式错误（非 2 段） → `{valid: false, reason: 'malformed', mock: true}`
- [x] payload 解析失败 → `{valid: false, reason: 'malformed', mock: true}`
- [x] 过期 license → `{valid: false, reason: 'expired', mock: true}`（旧代码是 valid:true）
- [x] 有效 license → `{valid: true, reason: 'valid', ...}`
- [x] 确认 mock 模式仍不验签（保持 SPEC：mock 只 stub 签名，不 stub 绑定）

### B.5 LicenseService 启动序

- [x] `LicenseService.startupCheck()` 方法：fingerprint → selfcheck → verify → 终态判定
- [x] `!valid && NODE_ENV === 'production'` → log error + `process.exit(1)`
- [x] `!valid && NODE_ENV !== 'production'` → log warn，继续
- [x] `app.module.ts` 的 `onModuleInit` 从 `verifyAndCache()` 改为 `startupCheck()`
- [x] 反回放状态文件路径 `license/.antireplay.json`，写权限 0600

### B.6 Spec 增量

- [x] `specs/license-build/spec.md` 的 3 个 requirement 合入 `openspec/specs/license-skeleton/spec.md`
- [x] 检查 SHA 编号不与已有冲突（M9-Bind-Integration=3.1.12 / M9-Bind-Mock-Strict=3.1.13 / M9-Bind-Coverage=3.1.14）

### B.7 测试

- [x] `license.service.spec.ts` 覆盖 startupCheck 四步顺序
- [x] `native-license.verifier.spec.ts` mock native 模块，验 selfcheck exit / fingerprint-mismatch / antireplay-failure
- [x] `mock-license.verifier.spec.ts` 覆盖 6 条路径（missing / bad-format / parse-error / expired / valid / fingerprint-mismatch）
- [x] `license.guard.spec.ts` 覆盖 invalid 场景（403）
- [x] `pnpm -C apps/adapter test:cov` 通过，覆盖率 ≥ 75%
- [x] `pnpm -C apps/adapter build` exit 0

### B.8 archive

- [x] 26/26 任务项全勾选后执行 archive