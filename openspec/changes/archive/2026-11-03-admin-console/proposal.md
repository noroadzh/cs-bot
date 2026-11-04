# 运营台

## Why

管理类操作目前只有 HTTP 接口。本期需要在不改接口契约的前提下，给出租户运营台和 SaaS 控制台，让未命中、素材、导入审核、授权、租户开通和审计可以在浏览器里完成。

## What Changes

- 新增 `apps/admin-web`：同一套 Vite + React 工程，按 `VITE_SURFACE` 打成租户包和平台包。
- 数据面在静态目录存在时把租户包挂到同源 `/console`，只调用 `/admin/*`。
- 控制面在静态目录存在时把平台包挂到同源 `/console`，只调用 `/platform/*`。控制面未启用时不挂平台静态资源。
- 浏览器把账号口令放在 `sessionStorage`，请求带 `Authorization: Basic`。不新增登录接口，不放宽 IP 白名单。
- 平台变更请求带 `reason`（或 `X-Operator-Reason`）。注销仍要求双签和一次性 `confirmToken`。
- 主动发送的分段幂等键明确为 `${traceId}:${段号}`。3.5 秒被动窗口只用于没有群聊 id 的消息。

## Non-goals

- 不改 `/admin` 与 `/platform` 的 URL、鉴权、入参和出参。
- 不把知识库页面做进本系统，知识运营仍用 FastGPT 自带后台。
- 不做角色分级、数据看板、自助开通或在线支付。
- 不做跳板终端，只保留现有 shell-access 审计接口。
- 不改报价单和建议书。
