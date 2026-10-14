# Change C: License Bind 与 issuer 工具 - Proposal

## Why

change A 完成了 Rust N-API 模块（native core），change B 完成了 TS 侧集成（load + startupCheck）。
但**交付层**仍有两块缺失：

1. **issuer 工具**：运营需要手动生成 license.lic（payload + Ed25519 签名），当前只能靠外部脚本
2. **Dockerfile 现编**：当前 `prebuilds/linux-x64-gnu/index.node` 是 macOS Mach-O（本地 build 产物不适配 Linux production）
   - Dockerfile 已改成 4-stage（stage 0 用 rust:1-bookworm 现编），但需要验证这个改动在 CI/CD 中能工作

**Need**：交付一个可复用的 `license` CLI 工具 + 确认 Dockerfile 产出的 .node 是 Linux ELF。

## What Changes

### C.1 license CLI 工具
在 `packages/license-native/` 目录下添加 `src/bin/` + 入口，提供两个子命令：

```bash
# 生成 license.lic
license issue \
  --fingerprint <sha256> \
  --expires-at 2026-12-31T23:59:59Z \
  --max-chats 100 \
  --output license/license.lic

# 验证 license.lic（本地离线验签）
license verify <license.lic>
```

- **issue**：
  - 读取编译期嵌入的**密钥对**（与 native 模块验签用的一致）
  - 读取 `test_keys/signing.pem`（PEM 格式 Ed25519 私钥）
  - 构建 JSON payload `{fingerprint, expiresAtMs, maxChats, ts}`
  - 用 Ed25519 签名，输出 `base64(payload).base64(sig)`
  - 支持 `--days` / `--seats` 简写
- **verify**：
  - 调用 native `verify()` 验签
  - 打印 `{valid, reason, expiresAtMs, maxChats}`

**工具化**：
- `package.json` 添加 `"bin": {"license": "./bin/license.js"}`
- `bin/license.js` 为 shim，读取 `process.env.LICENSE_NATIVE_PATH` 或 require `..`
- 源码 `src/bin/main.rs` 通过 `napi::CLI` 生成

### C.2 Dockerfile 验证
- 确认 `deploy/Dockerfile.adapter` 4-stage 结构符合设计（已在工作区）
- 确认 stage 0 产物 `target/x86_64-unknown-linux-gnu/release/liblicense_native.so` → `/native/index.node`
- 确认 stage 2 产物路径 `assets/packages/license-native/prebuilds/linux-x64-gnu/index.node`
- 写一个 `deploy/test-docker-build.sh` 脚本（本地或 CI）：
  ```bash
  docker build -f deploy/Dockerfile.adapter --target runtime --no-cache -t cs-bot:test .
  docker run --rm cs-bot:test file /app/packages/license-native/prebuilds/linux-x64-gnu/index.node
  # 期望: ELF 64-bit LSB shared object, x86-64, version 1 (SYSV)
  ```

### C.3 prebuilds 覆盖
- 本地 `prebuilds/linux-x64-gnu/index.node` 仍保留（macOS Mach-O）
- 改 `package.json` 的 `files` 字段：
  ```json
  "files": ["prebuilds/linux-x64-gnu/"]
  ```
- **Docker 阶段**会在容器内覆盖此目录（stage 2 → runtime），无需本地重新 build

### C.4 集成测试
- `deploy/test-license-flow.sh`：
  1. 用 `license issue` 生成 license.lic
  2. 启动容器（runtime 镜像）
  3. 验证 `GET /health` 返回 200，且日志无 license 告警
  4. 伪造 / 删除 license.lic，重启容器，验证 exit 1

### C.5 Spec 增量
- `openspec/specs/license-skeleton/spec.md` 新增 `M9-Bind-Deployment` requirement
- Scenario：
  - `M9-CLI-Issue`: `license issue` 成功生成 license.lic
  - `M9-CLI-Verify`: `license verify` 正确验签
  - `M9-Docker-Build`: Dockerfile 产出的 .node 是 Linux ELF
  - `M9-Docker-Deploy`: 容器启动时 license 校验通过

## Non-Goals

- **不**实现 license 吊销列表（revocation list）— 未来 feature
- **不**实现 license 远程校验服务器（offline 模式已满足 MVP）
- **不**实现 license 过期自动续期（手动 `license issue` 即可）
- **不**在 Dockerfile 中嵌入 issuer 工具（issuer 在宿主机运行，容器只跑 runtime）

## Impact

- **新增二进制**：`license` 命令行工具（随 pnpm workspace 安装）
- **CI 变更**：增加 `docker build` 验证步骤（~5min）
- **开发流**：
  - 开发者用 `license issue` 生成 license.lic
  - 用 `docker build` 验证 production 产物
- **配合**：
  - change A（native 模块）
  - change B（TS 集成 + startupCheck）
  - 本 change（CLI + Dockerfile 验证）

## 已知约束

- **issuer 私钥必须安全存储**：当前 `test_keys/signing.pem` 是明文 PEM（仅用于 dev/MVP）
  - 生产环境需要把私钥注入容器或使用 KMS
  - MVP 接受手动复制 `test_keys/signing.pem` 到安全位置
- **fingerprint 采集**：当前 `fingerprint()` 读取 Linux 特有文件（/proc/cpuinfo, /sys/class/dmi/id/...）
  - macOS 开发机无法本地跑 fingerprint（需要 Docker 或 CI）
  - 已在 `.cargo/config.toml` 中加入 macOS dynamic_lookup，但 fingerprint 逻辑本身是 Linux-only