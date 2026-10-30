# 运营台设计

## 形态

一个前端工程两次构建：

- `VITE_SURFACE=tenant` 产出 `apps/admin-web/dist-tenant`，由数据面 `main.ts` 挂到 `/console`。
- `VITE_SURFACE=platform` 产出 `apps/admin-web/dist-platform`，由控制面 `control-plane-main.ts` 挂到 `/console`。

Vite `base` 为 `/console/`。静态目录不存在时入口不挂载，测试和未构建的进程照常启动。目录可用 `ADMIN_CONSOLE_DIR` 覆盖。默认相对进程工作目录：数据面 `../admin-web/dist-tenant`，控制面 `../admin-web/dist-platform`。

静态处理只匹配 `/console`。`/wecom/callback` 不经过这层。

## 鉴权

登录页把账号和口令编码后写入 `sessionStorage`。之后的 `fetch` 设置 `Authorization: Basic`。401 清掉会话并回到登录页。口令、license 和密钥不写入前端日志。

平台写操作在 body 中带 `reason`。原因为空时不发请求。终止、导出、注销、写入密钥先经确认框。注销提交 `approvals` 与 `confirmToken`。

## 页面

租户：未命中列表与 xlsx 下载、素材上传/列表/删除、导入任务（上传、解析、逐条审核、批量通过、未配对补配、确认、回滚、重试）、授权状态与热加载、配置自检和关键词重载。

平台：租户列表与详情、创建、开通、续期、暂停、恢复、重启、终止、配额与用量、审计日志。导出、注销、密钥交接和跳板审计保留，跳板只记审计。

空列表、401 和接口错误在页面上可见。
