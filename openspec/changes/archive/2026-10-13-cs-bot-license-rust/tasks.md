# Change A: Rust 原生授权模块 - Tasks

```
A.1 scaffold        Cargo.toml + src/lib.rs 空壳 + build.rs + test_keys/
A.2 verify          Ed25519 验签 + JSON payload 解析 + 过期/篡改分支 + 单元测试 ≥ 6 例
A.3 fingerprint     /proc/cpuinfo model + /sys/class/dmi/id/product_uuid + /sys/class/net MAC + lsblk serial + 单元测试 ≥ 4 例
A.4 antireplay      license.state 读/写/推进/回拨判定 + 单元测试 ≥ 5 例
A.5 selfcheck       debugPort + TracerPid + LD_PRELOAD + 返 evidence 数组 + 单元测试 ≥ 3 例
A.6 napi 暴露       #[napi] 4 函数 + TypeScript 类型自动生成（napi-derive） + Rust 单元测试
A.7 prebuild        napi build --platform linux --arch x64 --target x86_64-unknown-linux-gnu → prebuilds/linux-x64-gnu/index.node
A.8 strip 验证      file/objdump 验证符号表空 + size 报告
A.9 archive         specs 合入 license-skeleton 主 spec
```

## Task 详情

### A.1 scaffold

- [x] 创建 `packages/license-native/Cargo.toml`
- [x] 创建 `packages/license-native/build.rs`
- [x] 创建 `packages/license-native/src/lib.rs` 空壳（4 个 #[napi] 函数 stub）
- [x] 创建 `packages/license-native/test_keys/` 目录并写入测试密钥
- [x] 创建 `packages/license-native/package.json`
- [x] cargo build --release 验证编译通过

### A.2 verify

- [x] 实现 base64 decode signature
- [x] 实现 JSON payload 解析 {payload, fingerprint, expiresAtMs, maxChats, ts}
- [x] 实现 Ed25519 验签（公钥编译期 embed）
- [x] 实现过期检测
- [x] 实现空指纹检测
- [x] 单元测试 ≥ 6 例：合法 / 篡改签名 / 过期 / payload 错 / 缺指纹 / 签名格式错

### A.3 fingerprint

- [x] 实现 /proc/cpuinfo model name 读取
- [x] 实现 /sys/class/dmi/id/product_uuid 读取
- [x] 实现 /sys/class/net/eth0/address 读取（容错 eth0 不存在）
- [x] 实现 lsblk -d -o SERIAL -n 读取
- [x] 实现 SHA-256 拼接
- [x] 单元测试 ≥ 4 例：全部成功 / 缺某文件 / 命令失败 / 权限拒绝

### A.4 antireplay

- [x] 实现 state 文件读取（JSON）
- [x] 实现 state 文件创建（首次运行）
- [x] 实现时间回拨检测
- [x] 实现 state 推进写入
- [x] 单元测试 ≥ 5 例：新文件 / 正常推进 / 回拨 / 断电恢复 / 并发写入

### A.5 selfcheck

- [x] 实现 debugPort 检测（env DEBUG_PORT / process.debugPort）
- [x] 实现 /proc/self/status TracerPid 检测
- [x] 实现 LD_PRELOAD / LD_LIBRARY_PRELOAD 检测
- [x] 实现 evidence 数组收集
- [x] 单元测试 ≥ 3 例：clean / debugger / tracer / LD_PRELOAD

### A.6 napi 暴露

- [x] 4 函数标记 #[napi]
- [x] napi-derive 自动生成 TypeScript 类型
- [x] cargo test 验证 Rust 单元测试
- [x] 验证 Node 端 require('@cs-bot/license-native') 加载成功

### A.7 prebuild

- [x] napi build --platform linux --arch x64 --target x86_64-unknown-linux-gnu --strip
- [x] 产物写入 prebuilds/linux-x64-gnu/index.node
- [x] 验证产物可被 Node 加载

### A.8 strip 验证

- [x] nm -gC prebuilds/linux-x64-gnu/index.node | grep -v "U \|T _" 验证无导出符号
- [x] ls -lh prebuilds/linux-x64-gnu/index.node 记录大小
- [x] objdump -t prebuilds/linux-x64-gnu/index.node | grep .symtab 确认无符号表

### A.9 archive

- [x] 将 specs/license-native-core/spec.md 增量合入 openspec/specs/license-skeleton/spec.md
- [x] 删除 change A 目录（已完成）
- [x] 更新 openspec/changes/archive/2026-10-13-cs-bot-license-rust/ 记录