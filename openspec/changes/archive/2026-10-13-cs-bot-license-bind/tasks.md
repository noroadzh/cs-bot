# Change C: License Bind 与 issuer 工具 - Tasks

## Task 详情

### C.1 license CLI — issue

- [x] `packages/license-native/bin/license.js` shim 骨架（shebang + ESM）
- [x] 参数解析：`issue --fingerprint --expires-at --max-chats --output` / `verify <file>` / `fingerprint`
- [x] 读取 `test_keys/signing.pem` → PKCS8 → Ed25519 SigningKey
- [x] 省略 `--fingerprint` 时调 native `fingerprint()` 取本机指纹；macOS 抛错 → 人类可读提示 + exit 1
- [x] 构建 payload **snake_case**：`{payload:"cs-bot-license-v1", fingerprint, expires_at_ms, max_chats, ts: Date.now()}`
- [x] JSON 字符串化（**不**做 base64 二次编码）作为签名原文
- [x] Ed25519 签名 JSON 原文 → base64(sig)
- [x] 输出 `base64(JSON原文).base64(sig)` 到 `--output`（默认 `license/license.lic`）
- [x] 输出文件已存在且无 `--force` → exit 1 + 提示

### C.2 license CLI — verify

- [x] 读文件 → 切分 `.` → payloadB64 / sigB64
- [x] `payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8')`
- [x] 调 native `verify(payloadJson, sigB64)`（**JSON 原文，不是 base64**）
- [x] 打印 JSON `{valid, reason, expires_at_ms, max_chats, days_left}`
- [x] valid → exit 0；invalid → exit 1
- [x] native 模块加载失败 → 人类可读错误 + exit 1（非未捕获异常）

### C.3 package.json 接入

- [x] `packages/license-native/package.json` 添加 `"bin": {"license": "./bin/license.js"}`
- [x] `files` 收窄为 `["prebuilds/linux-x64-gnu/", "bin/"]`
- [x] 添加 scripts `issue` / `verify`
- [x] `chmod +x bin/license.js`

### C.4 Dockerfile ELF 验证

- [x] 读 `deploy/Dockerfile.adapter` 确认 stage 0 是 `rust:1-bookworm` 且 target 为 `x86_64-unknown-linux-gnu`
- [x] 确认产物路径为 `/native/index.node`
- [x] 确认 stage 2 (assets) 拷贝到 `packages/license-native/prebuilds/linux-x64-gnu/index.node`
- [x] 确认 stage 3 (runtime) 中该路径被覆盖（而非仓库里的 Mach-O）

### C.5 验证脚本

- [x] `deploy/test-docker-build.sh`：docker build --target runtime
- [x] `docker run --rm <img> file .../index.node` 断言输出含 `ELF 64-bit LSB shared object, x86-64`
- [x] 非 ELF → exit 1 并打印实际 file 输出
- [x] 脚本加 `set -euo pipefail`

### C.6 E2E 脚本

- [x] `deploy/test-license-flow.sh`
- [x] 步骤 1：`license issue --expires-at <未来> --output license/license.lic`
- [x] 步骤 2：docker build --target runtime -t cs-bot:license-e2e
- [x] 步骤 3：docker run -d，license 目录挂到 `/app/license`
- [x] 步骤 4：`curl -f /health` + `docker logs | grep license-ok`
- [x] 步骤 5：trap 清理容器
- [x] 失败路径：删除 license.lic 重启 → 断言 exit 1

### C.7 Spec 增量

- [x] `specs/license-bind/spec.md` 的 3 个 requirement 合入 `openspec/specs/license-skeleton/spec.md`
- [x] SHA 编号：M9-Bind-CLI=3.1.15 / M9-Bind-Docker-ELF=3.1.16 / M9-Bind-E2E-Flow=3.1.17

### C.8 文档

- [x] `README.md` 增加「签发 license」小节（`license issue` 用法 + 挂载方式）
- [x] `docs/03-交付实施/部署手册-微信群智能客服机器人MVP.md` 补 license 部署章节
- [x] 记录私钥管理约束（生产需 KMS，MVP 明文 PEM 存 test_keys/）

### C.9 archive

- [x] 全部任务项勾选后执行 archive