# 授权签发与交付分离

交付人员的电脑和客户部署包都不放签发程序和私钥。私钥只在厂商内部签发机（或 SaaS 控制面）上。交付人员只传递授权申请码和签好的 `license.lic`。

## 角色

- 客户管理员：在已装好的系统上导出指纹，放入收到的 `license.lic`，执行热加载。
- 交付人员：收集申请码、到期日、群数上限，交给签发岗；把返回的证书文件放到 `license/license.lic`。
- 签发岗：唯一能接触 `issuer-private.pem` 和 `tools/license-issuer` 的人。签发机不给交付人员登录。

## 私有化流程

1. 客户机器安装后，管理员调用 `GET /admin/license`，把返回的 `fingerprint` 交给交付人员。
2. 交付人员把指纹、客户名、到期日、最大群数提交给签发岗（工单即可，先不必做新界面）。
3. 签发岗在签发机执行现有 `license-issuer.mjs`，得到 `license.lic`。
4. 交付人员把文件放到客户机 `license/license.lic`，再 `POST /admin/license/reload`。

SaaS 开通和续期继续走控制面里的 `ShellLicenseIssuer`，私钥仍只挂在控制面主机。

## 不要做的事

- 不把签发程序做成 Electron，也不拷到交付人员电脑。
- 不把 `tools/license-issuer` 或 `issuer-private.pem` 放进客户部署包。
- 不给交付人员一个能自己点签发的账号。否则私钥虽不在他电脑上，他仍能签发任意指纹。
