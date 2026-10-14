# Design: License Build 集成

## 概述

change A 完成了 Rust N-API 模块（native core），change B 将其在 TS 侧集成并强化启动校验。

## 目标

- **依赖注入**：`apps/adapter` 依赖 `@cs-bot/license-native`
- **Native 加载**：NativeLicenseVerifier 加载 native 模块并调用 4 个 N-API 函数
- **启动强校验**：启动时依次执行 fingerprint → selfcheck → verify → antireplay
- **Mock 强化**：mock 模式也做格式校验和 fingerprint 绑定（不再无条件通过）
- **覆盖率**：≥ 75%

## Rust N-API 契约（以 lib.rs 实际实现为准）

```typescript
// 包名 @cs-bot/license-native，require 后返回：
verify(payload_json: string, sig_b64: string): VerifyOutput
//   payload_json 是 JSON 原文（不是 base64）！Rust 侧 serde_json::from_str 解析
//   LicensePayload 字段（snake_case）：{payload, fingerprint, expires_at_ms, max_chats, ts}
//   VerifyOutput: {valid, reason: string|null, expires_at_ms, max_chats}
//   reason 可能值: 'invalid_signature_length' | 'invalid payload json: ...' | 'bad_signature'
//                 | 'expired' | 'bad_fingerprint' | 'invalid_timestamp' | null

fingerprint(): string          // 64-hex SHA-256；仅 Linux 可用，macOS 会 throw napi error
antireplay(state_path: string, now_ms: number): {ok, advanced, last_ts}
//   ok=false 表示时间回拨；state 损坏视为新安装（last_ts=0）；写失败 throw napi error
selfcheck(): {clean: boolean, evidence: string[]}
//   evidence 可能值: 'tracer' | 'debugPort' | 'ld_preload' | 'ld_library_preload'
//   /proc/self/status 读取失败（如 macOS）该项自动跳过
```

## License 文件格式

`base64(JSON_payload).base64(Ed25519_sig)` — 点分隔两段。

payload JSON 键必须 snake_case（Rust serde 默认）：
```json
{
  "payload": "cs-bot-license-v1",
  "fingerprint": "<64hex>",
  "expires_at_ms": 1798761599000,
  "max_chats": 1000,
  "ts": 1728800000000
}
```

TS 侧 native verify 流程：decode parts[0] → JSON 原文 → `native.verify(jsonStr, sigB64)`。
fingerprint 绑定比对在 TS 侧进行（native verify 只查非空，不查预期值）。

## 集成架构

```
┌─────────────────────────────────────────────────────────────────┐
│  AppModule.onModuleInit                                         │
│  ├─ licenseService.startupCheck()                               │
│  │   ├─ 1. fingerprint()        → 缓存 expectedFingerprint      │
│  │   ├─ 2. selfcheck()          → 反调试/反注入，失败 exit 1    │
│  │   ├─ 3. verifyAndCache()     → 验 license + antireplay      │
│  │   └─ 4. 若 !valid → exit 1 (prod) / warn (dev)               │
│  └─ 启动完成                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## B.1 package.json 依赖

**当前**：`apps/adapter/package.json` 无 `@cs-bot/license-native` 依赖

**改动**：
```json
{
  "dependencies": {
    "@cs-bot/license-native": "workspace:*",
    "@cs-bot/shared": "workspace:*"
  }
}
```

执行 `pnpm install` 后：
```
node_modules/@cs-bot/license-native/
├── package.json
└── prebuilds/linux-x64-gnu/index.node   ← ELF 64-bit
```

## B.2 NativeLicenseVerifier 重写

```typescript
// native-license.verifier.ts
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const native = require('@cs-bot/license-native');

export class NativeLicenseVerifier implements ILicenseVerifier {
  private readonly statePath = 'license/.antireplay.json';
  private readonly expectedFingerprint: string | undefined;

  constructor(private readonly config: ConfigService) {
    const native = loadNative();
    // selfcheck 仅 native 模式跑；macOS 上 /proc 读不到会跳过 tracer 检测
    const sc = native.selfcheck();
    if (!sc.clean) {
      this.logger.error({ detail: 'tamper-detected', evidence: sc.evidence });
      process.exit(1);
    }
    // macOS 无 /proc/cpuinfo → fingerprint() 抛错，降级为 undefined（跳过绑定校验）
    this.expectedFingerprint = tryFingerprint(native);
  }

  async verify(): Promise<LicenseState> {
    const native = loadNative();
    const raw = readFileSync(this.config.LICENSE_FILE, 'utf8').trim();
    const [payloadB64, sigB64] = raw.split('.');
    if (raw.split('.').length !== 2) {
      return { valid: false, reason: 'malformed', mock: false };
    }

    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    const result = native.verify(payloadJson, sigB64);   // ← JSON 原文，不是 base64

    if (!result.valid) {
      return {
        valid: false,
        reason: result.reason === 'expired' ? 'expired' : 'malformed',
        mock: false,
      };
    }

    // fingerprint 绑定：native 只查非空，预期值比对在 TS 侧
    const payload = JSON.parse(payloadJson);
    if (this.expectedFingerprint && payload.fingerprint !== this.expectedFingerprint) {
      return { valid: false, reason: 'fingerprint-mismatch', mock: false };
    }

    const ar = native.antireplay(this.statePath, Date.now());
    if (!ar.ok) {
      return { valid: false, reason: 'antireplay-rollback', mock: false };
    }

    const expiresAtMs = result.expires_at_ms;
    return {
      valid: true,
      reason: 'valid',
      expiresAt: new Date(expiresAtMs).toISOString(),
      daysLeft: Math.ceil((expiresAtMs - Date.now()) / 86400000),
      maxChats: result.max_chats,
      fingerprint: payload.fingerprint,
      mock: false,
    };
  }
}
```

## B.3 fingerprint 绑定

| 模式 | fingerprint 行为 |
|------|-----------------|
| **native** | 启动时调用 `fingerprint()` → 缓存 → verify 时 native 侧已校验 |
| **mock** | 启动时调用 `fingerprint()` → 缓存 → verify 时 TS 侧比对 |

TS 侧缓存 `expectedFingerprint`，在 `verify()` 返回后检查：
```typescript
if (state.fingerprint !== this.expectedFingerprint) {
  return { valid: false, reason: 'fingerprint-mismatch', mock: false };
}
```

## B.4 Mock 强校验

**当前**（弱校验）：
```typescript
// mock-license.verifier.ts
if (!existsSync(this.licenseFile)) {
  return { valid: true, reason: 'mock', mock: true };  // ← 永远 valid
}
```

**改动后**（强校验）：
```typescript
if (!existsSync(this.licenseFile)) {
  return { valid: false, reason: 'mock-no-license', mock: true };
}
```

| 场景 | 旧行为 | 新行为 |
|------|--------|--------|
| license.lic 不存在 | valid: true, reason: 'mock' | **valid: false, reason: 'mock-no-license'** |
| license.lic 格式错误 | valid: true, reason: 'malformed' | **valid: false, reason: 'malformed'** |
| license.lic 格式正确 | valid: true, reason: 'valid' | valid: true, reason: 'valid' |
| fingerprint 不匹配 | 忽略 | **valid: false, reason: 'fingerprint-mismatch'** |

## B.5 LicenseService 启动序

```typescript
// license.service.ts
@Injectable()
export class LicenseService {
  async startupCheck(): Promise<void> {
    // 1. fingerprint
    this.expectedFingerprint = await this.verifier.fingerprint();

    // 2. selfcheck (仅 native 模式)
    if (this.verifier instanceof NativeLicenseVerifier) {
      const selfcheck = (this.verifier as any).selfcheck?.();
      if (selfcheck && !selfcheck.clean) {
        this.logger.error({ detail: 'selfcheck-failed', evidence: selfcheck.evidence });
        process.exit(1);
      }
    }

    // 3. verify + antireplay
    const state = await this.verifyAndCache();

    // 4. 终态校验
    if (!state.valid) {
      const msg = `[License] Invalid: ${state.reason}`;
      if (ConfigService.instance.NODE_ENV === 'production') {
        this.logger.error({ detail: 'license-invalid-exit', reason: state.reason });
        process.exit(1);
      } else {
        this.logger.warn({ detail: 'license-invalid-warn', reason: state.reason });
      }
    }
  }
}
```

在 `app.module.ts` 中调用：
```typescript
async onModuleInit() {
  await this.licenseService.startupCheck();
}
```

## B.6 测试策略

| 测试文件 | 覆盖点 |
|----------|--------|
| `license.service.spec.ts` | startupCheck 4 步 |
| `native-license.verifier.spec.ts` | 4 N-API 函数编排 |
| `mock-license.verifier.spec.ts` | 强校验 4 路径 |
| `license.guard.spec.ts` | fingerprint mismatch |

## B.7 Spec 增量

在 `openspec/specs/license-skeleton/spec.md` 新增：

```markdown
### M9-Bind-Integration

The system MUST integrate the native license module at startup:

#### Scenario: Startup selfcheck failure

- **Given** a process with debugger attached or LD_PRELOAD set
- **When** the license module loads and calls `selfcheck()`
- **Then** the process exits with code 1 and logs evidence[]

#### Scenario: Startup fingerprint capture

- **Given** a Linux host with /proc/cpuinfo, /sys/class/dmi/id/product_uuid
- **When** the license module calls `fingerprint()`
- **Then** it returns a 64-char hex SHA-256 hash

#### Scenario: Mock mode license missing

- **Given** USE_MOCK_LICENSE=true and no license/license.lic file
- **When** LicenseService.verifyAndCache() is called
- **Then** it returns {valid: false, reason: 'mock-no-license', mock: true}

#### Scenario: Fingerprint mismatch

- **Given** a license.lic with fingerprint not matching the host
- **When** LicenseService.verifyAndCache() is called
- **Then** it returns {valid: false, reason: 'fingerprint-mismatch', mock: false}
```

## 风险与回退

| 风险 | 缓解 |
|------|------|
| macOS 开发机无法跑 fingerprint | 单元测试 mock native 模块；CI 用 Docker |
| selfcheck 误杀（容器内 debugPort 非零） | 跳过 selfcheck 在非 production 环境 |
| .node 加载失败导致启动失败 | 启动前检查文件存在性，缺失则 warn 但继续 |