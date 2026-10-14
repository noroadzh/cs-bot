# Design: License Bind 与 issuer 工具

## 概述

change A 完成了 Rust N-API 模块，change B 完成了 TS 侧集成。
change C 提供 **issuer CLI 工具** + **Dockerfile 验证脚本**，完成交付闭环。

## 目标

- **CLI 工具**：`license issue` / `license verify` 两条命令
- **Dockerfile 验证**：确保 4-stage 构建产出的 .node 是 Linux ELF
- **集成测试**：本地验证 license 签发 → 容器启动 → 校验通过

## C.1 license CLI 工具

### 架构

```
packages/license-native/
├── bin/license.js          # shim，入口
├── src/bin/main.rs         # CLI 实现
├── package.json            # "bin": {"license": "./bin/license.js"}
└── test_keys/signing.pem   # Ed25519 私钥（PEM）
```

### bin/license.js

```javascript
#!/usr/bin/env node
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const native = require('@cs-bot/license-native');

const cmd = process.argv[2];
const args = process.argv.slice(3);

if (cmd === 'issue') {
  // ...
} else if (cmd === 'verify') {
  // ...
} else {
  console.error('Usage: license <issue|verify>');
  process.exit(1);
}
```

### issue 子命令

```bash
license issue \
  --fingerprint 0123456789abcdef... \
  --expires-at 2026-12-31T23:59:59Z \
  --max-chats 100 \
  --output license/license.lic
```

**实现**：
1. 读取 `test_keys/signing.pem`（Ed25519 私钥，PEM → PKCS8）
2. 读取 `--fingerprint`（或从本机 `fingerprint()` 获取）
3. 解析 `--expires-at` 为毫秒时间戳
4. 构建 payload JSON（**snake_case，与 Rust serde 对齐**）：
   `{payload:"cs-bot-license-v1", fingerprint, expires_at_ms, max_chats, ts: Date.now()}`
5. Ed25519 私钥签名 **JSON 原文** → base64(sig)
6. 输出：`base64(JSON原文).base64(sig)` 到 `--output`（默认 `license/license.lic`）
7. 打印指纹，便于运维核对绑定的机器

> 关键：Rust `verify()` 签名对象是 `payload_json.as_bytes()`（JSON 原文），
> 不是 base64 串。所以 Node 侧必须签 `Buffer.from(jsonStr, 'utf8')`，
> 而不能签 `Buffer.from(base64(jsonStr), 'utf8')`。

### verify 子命令

```bash
license verify license/license.lic
```

**实现**：
1. 读取文件，切割 `.` → payloadB64, sigB64
2. `payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8')`
3. 调用 native `verify(payloadJson, sigB64)`
4. 打印结果：`{valid, reason, expires_at_ms, max_chats, days_left}`
5. valid → exit 0；invalid → exit 1

### fingerprint 子命令

```bash
license fingerprint
```

`fingerprint()` 仅在 Linux 有效（读 `/proc/cpuinfo`、`/sys/class/dmi/id/product_uuid`、
`lsblk`）。macOS 上会抛 napi error，需给出人类可读提示而非堆栈。

### package.json 配置

```json
{
  "name": "@cs-bot/license-native",
  "bin": {
    "license": "./bin/license.js"
  },
  "scripts": {
    "issue": "node bin/license.js issue",
    "verify": "node bin/license.js verify"
  }
}
```

## C.2 Dockerfile 验证

### 4-stage 结构（已就绪）

```dockerfile
# Stage 0: native
FROM rust:1-bookworm AS native
RUN cargo build --release --target x86_64-unknown-linux-gnu

# Stage 1: builder
FROM node:20-bookworm-slim AS builder

# Stage 2: assets
FROM scratch AS assets
COPY --from=native /native/index.node /assets/...

# Stage 3: runtime
FROM gcr.io/distroless/nodejs20-debian12:nonroot
```

### 验证脚本

```bash
#!/bin/bash
# deploy/test-docker-build.sh

set -e

IMAGE_NAME="cs-bot:license-test"

# 1. Build
docker build -f deploy/Dockerfile.adapter \
  --target runtime \
  --no-cache \
  -t "$IMAGE_NAME" .

# 2. 验证 .node 是 ELF
docker run --rm "$IMAGE_NAME" \
  file /app/packages/license-native/prebuilds/linux-x64-gnu/index.node

# 期望输出:
# /app/packages/license-native/prebuilds/linux-x64-gnu/index.node: ELF 64-bit LSB shared object, x86-64, version 1 (SYSV), dynamically linked, not stripped

# 3. 验证 runtime 可启动
docker run --rm -e NODE_ENV=production \
  --entrypoint node \
  "$IMAGE_NAME" --version
```

## C.3 prebuilds 覆盖

**当前**：`prebuilds/linux-x64-gnu/index.node` 是 macOS Mach-O（本地 dev build）

**改动**：
```json
// packages/license-native/package.json
{
  "files": [
    "prebuilds/linux-x64-gnu/"
  ]
}
```

**Docker 阶段覆盖**：
- Stage 2 (assets) 会把 `COPY --from=native /native/index.node` 覆盖到镜像内
- 本地 `prebuilds/` 目录保留，仅用于 `pnpm install` 后不报 "missing file" 错误

## C.4 集成测试

```bash
#!/bin/bash
# deploy/test-license-flow.sh

set -e

# 1. 生成 license
cd packages/license-native
node bin/license.js issue \
  --fingerprint "$(node bin/license.js fingerprint)" \
  --expires-at 2027-01-01T00:00:00Z \
  --max-chats 1000 \
  --output ../../license/license.lic

# 2. 构建镜像
docker build -f ../../deploy/Dockerfile.adapter \
  --target runtime \
  -t cs-bot:license-e2e .

# 3. 启动 + 健康检查
docker run -d --name cs-bot-e2e \
  -e NODE_ENV=production \
  -v "$(pwd)/../../license:/app/license" \
  cs-bot:license-e2e

sleep 5
curl -f http://localhost:3000/health

# 4. 验证 license 校验通过
docker logs cs-bot-e2e | grep -q "license-ok"

# 5. 清理
docker stop cs-bot-e2e && docker rm cs-bot-e2e
```

## C.5 Spec 增量

在 `openspec/specs/license-skeleton/spec.md` 新增：

```markdown
### M9-Bind-Deployment

The system MUST provide a CLI tool for license issuance and a Docker build that produces a Linux-compatible native module.

#### Scenario: CLI issue

- **Given** a signing key exists at `test_keys/signing.pem`
- **When** the operator runs `license issue --fingerprint X --expires-at Y --max-chats Z`
- **Then** a file `license/license.lic` is created with format `<base64payload>.<base64sig>`

#### Scenario: CLI verify

- **Given** a license file exists
- **When** the operator runs `license verify <file>`
- **Then** it prints `{valid: boolean, reason: string, expiresAtMs: number, maxChats: number}`

#### Scenario: Docker build produces ELF

- **Given** a Dockerfile with 4-stage build
- **When** `docker build -f deploy/Dockerfile.adapter --target runtime` succeeds
- **Then** the resulting image contains `prebuilds/linux-x64-gnu/index.node` as ELF 64-bit LSB shared object

#### Scenario: Docker deployment license check

- **Given** a container built from the Dockerfile
- **When** the container starts with a valid license file mounted
- **Then** the service logs "license-ok" and health endpoint returns 200
```

## 风险与约束

| 风险 | 缓解 |
|------|------|
| issuer 私钥明文存储 | MVP 接受手动复制 test_keys/signing.pem 到安全位置 |
| macOS 开发机跑 fingerprint | CLI 在 Linux 容器内运行；本地用 mock |
| Docker build 时间过长 | 4-stage 缓存利用；仅改 src/ 时只重编 native |