# license-issuer（交付方内部工具）

签发 M9 授权证书，不随运行时镜像分发。

```bash
node license-issuer.mjs \
  --key issuer-private.pem \
  --fingerprint "<sha256 授权申请码>" \
  --expires 2027-10-11 \
  --max-chats 15 \
  --out license.lic
```

- 输出：`base64(payload JSON).base64(Ed25519 signature)`，与 `packages/license-native` 的 `verify` 对齐。
- 私钥仅存交付方；运行时镜像无 `tools/`。
- 证书放入部署目录 `license/license.lic` 后重启或调 `POST /admin/license/reload`。
