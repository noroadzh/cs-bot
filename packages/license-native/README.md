# license-native

Rust napi-rs 原生模块占位目录。后续注入时结构：

```
prebuilds/
  linux-x64-gnu/node_native.node
  darwin-arm64/node_native.node
  win32-x64-msvc/node_native.node
src/
  index.ts          ← TypeScript wrapper（可选，若直接 .node）
package.json        ← name: @cs-bot/license-native
```

当前仅导出空函数占位，开发期由 `MockLicenseVerifier` 承担全部逻辑。
