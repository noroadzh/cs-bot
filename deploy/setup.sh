#!/usr/bin/env bash
# 分步部署向导（私有化）。install.sh 仍是非交互启动，本脚本负责按步骤说明并填写。
#
#   sudo ./deploy/setup.sh           # 逐步填写、放入证书、启动
#   ./deploy/setup.sh --steps        # 只打印步骤说明，不写文件、不启动
#   ./deploy/setup.sh --after        # 部署完成后，企微后台和后续修改对照
#   ./deploy/setup.sh --help
set -euo pipefail

ROOT="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$ROOT/.env"
DOMAIN_FILE="$ROOT/deploy/setup-domain"
FASTGPT_IMAGE_CN="registry.cn-hangzhou.aliyuncs.com/fastgpt/fastgpt:v4.8.17"
FASTGPT_IMAGE_OS="ghcr.io/labring/fastgpt:v4.8.17"

die() { echo "[setup] ERROR: $*" >&2; exit 1; }

require_tty() {
  [ -t 0 ] || die "请在终端里执行 sudo ./deploy/setup.sh。只看说明可执行 ./deploy/setup.sh --steps"
}

pause() {
  local ans=""
  read -r -p "回车继续，输入 q 退出: " ans || true
  case "$ans" in
    q|Q) echo "已停止。容器尚未因为本向导而启动。"; exit 0 ;;
  esac
}

ask() {
  # $1 提示  $2 默认值（可空）  $3 为 1 时允许空
  local prompt="$1" default="${2-}" allow="${3:-0}" reply=""
  while true; do
    if [ -n "$default" ]; then
      read -r -p "$prompt [$default]: " reply || true
      reply="${reply:-$default}"
    else
      read -r -p "$prompt: " reply || true
    fi
    if [ -n "$reply" ] || [ "$allow" = "1" ]; then
      printf '%s' "$reply"
      return 0
    fi
    echo "这项不能空。" >&2
  done
}

set_kv() {
  local key="$1" val="$2" tmp
  case "$val" in
    *$'\n'*|*'#'*) die "$key 的值里不能有换行或 #。口令请用向导生成的十六进制。" ;;
  esac
  [ -f "$ENV_FILE" ] || die "缺少 $ENV_FILE"
  tmp="$(mktemp)"
  CS_KEY="$key" CS_VAL="$val" awk '
    BEGIN { k = ENVIRON["CS_KEY"]; v = ENVIRON["CS_VAL"] }
    index($0, k "=") == 1 { print k "=" v; found = 1; next }
    { print }
    END { if (!found) print k "=" v }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

ensure_env() {
  if [ ! -f "$ENV_FILE" ]; then
    [ -f "$ROOT/.env.template" ] || die "缺少 .env.template"
    cp "$ROOT/.env.template" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
}

copy_into() {
  local src="$1" dest="$2" mode="$3"
  [ -f "$src" ] || die "找不到文件: $src"
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  chmod "$mode" "$dest"
}

explain_env() {
  cat <<'EOF'
步骤 1/8  确认这是生产机器
作用：后面写入的企业微信、模型和口令都落在本目录的 .env。适配层容器只读这个文件。
影响：USE_MOCK_LLM=true 时群里收到的是假答案，不会请求 DeepSeek 或通义。
      USE_MOCK_LICENSE=true 时不校验授权签名，正式 license 等于没启用。
      生产两项都写 false。改完要执行 compose up -d，restart 不会重新读取 .env。
EOF
}

explain_wecom() {
  cat <<'EOF'
步骤 2/8  企业微信（从企微管理后台抄）
  WECHAT_CORP_ID          我的企业 → 企业信息 → 企业 ID。填错则主动调用企微接口失败。
  WECHAT_AGENT_ID         自建应用的 AgentId。填错则发不出群消息。
  WECHAT_AGENT_SECRET     同一应用的 Secret。填错则取 access_token 失败，机器人不能发消息。
  WECHAT_TOKEN            接收消息页的 Token。与企微后台不一致时，回调校验失败，消息进不来。
  WECHAT_ENCODING_AES_KEY 接收消息页的 EncodingAESKey，必须正好 43 位。不一致则消息解不开。
  WECHAT_BOT_USER_ID      可选。按成员账号识别 @。留空不影响按显示名识别。
  WECHAT_BOT_NAME         可选。群里 @ 的显示名。留空时只靠成员 ID 或默认匹配。
回调 URL 不写进 .env。部署完成后再到企微「接收消息」填写，见 --after。
EOF
}

explain_llm() {
  cat <<'EOF'
步骤 3/8  大模型
  LLM_PRIMARY_API_KEY    DeepSeek 开放平台的 Key。无效时主模型失败，改走备用模型。
  LLM_FALLBACK_API_KEY   阿里云百炼的 Key。两个都无效时，群里收到「系统繁忙」话术。
  两个接口地址保持默认即可。地址写错时，对应通道超时并计入失败告警。
  图片识别默认关闭。要识别群图片时再把 MOCK_MEDIA_RECOGNIZE 改成 false 并填写 QWEN_VL_API_KEY。
EOF
}

explain_secrets() {
  cat <<'EOF'
步骤 4/8  口令（向导生成，不是从别的系统查到的）
  运营台首个管理员      用户名/密码写入数据库 admin_user（不再用 .env 登录）。启动后用该账号打开 /console。
  POSTGRES_PASSWORD      第一次启动时写入数据库。之后只改 .env 不会改掉库里已有口令，适配层会连不上库。
  FASTGPT_ROOT_PASSWORD  FastGPT 登录口令，用户名固定 root。只在第一次初始化时生效。
  FASTGPT_FILE_TOKEN     内部文件令牌，不能用来登录。之后修改会使已有文件链接失效。
  REDIS_PASSWORD         必须留空。填了之后健康检查不带口令，Redis 会一直不健康，适配层不起。
请当场抄下管理员口令与库口令，向导不会再次显示。
EOF
}

explain_access() {
  cat <<'EOF'
步骤 5/8  谁能访问，以及 FastGPT 地址
  域名                    只用于生成企微回调说明，不写入适配层配置。DNS 要指到这台机器。
  ALLOWED_ADMIN_IPS       能调用 /admin 的来源，写成 x.x.x.x/32。不在名单里的请求被拒绝。
  FASTGPT_ADMIN_ALLOW_CIDRS  能打开 https://域名:8443 的来源。留空表示谁都不能打开。
  FASTGPT_BASE_URL        固定 http://fastgpt:3000，这是容器内网。写成公网地址会导致适配层访问不到知识库。
  FASTGPT_API_KEY         先写占位符。真实 Key 要等 FastGPT 建好应用后复制，再 up -d adapter。
  FASTGPT_IMAGE           国内用阿里云镜像。海外机器用 ghcr.io，否则拉镜像失败。
EOF
}

explain_files() {
  cat <<'EOF'
步骤 6/8  证书和授权文件
  deploy/nginx/certs/fullchain.pem  站点证书。企微保存回调时会访问 https://域名/wecom/callback，证书不受信任则保存失败。
  deploy/nginx/certs/privkey.pem    私钥。权限收成 600。
  license/license.lic               交付方按这台机器签发的授权。文件名必须小写。缺失或验签失败时进入受限模式，不回答问题。
TLS 推荐：域名已解析到本机时选 Let's Encrypt（公网 CA，约 90 天自动续期），不要用 openssl 自签（企微校验会失败）。
也可粘贴已有 fullchain.pem / privkey.pem 路径。向导会调用 deploy/issue-letsencrypt.sh 申请并安装续期 hook。
不用改 nginx.conf。域名靠 DNS，不靠 server_name。
EOF
}

explain_start() {
  cat <<'EOF'
步骤 7/8  准备镜像并启动
先加载包内适配层镜像，再拉取 nginx、FastGPT、PostgreSQL、MongoDB、Redis。
然后执行 install.sh：预检口令、校验证书和授权、启动 6 个服务、等待 /healthz。
预检失败时不会启动容器。
EOF
}

explain_after_intro() {
  cat <<'EOF'
步骤 8/8  部署完成后要到企业微信改什么
脚本改不了企微管理后台。系统起来之后，打开该自建应用 → 接收消息，按下面对照填写并保存。
保存成功后再把应用拉进测试群，@机器人 提问。
EOF
}

print_after() {
  local domain="<你的域名>"
  if [ -f "$DOMAIN_FILE" ]; then
    domain="$(tr -d '[:space:]' < "$DOMAIN_FILE")"
  fi
  [ -n "$domain" ] || domain="<你的域名>"
  explain_after_intro
  cat <<EOF

企微后台填写（和 .env 必须一致，否则回调校验或解密失败）：
  URL              https://${domain}/wecom/callback
  Token            .env 的 WECHAT_TOKEN
  EncodingAESKey   .env 的 WECHAT_ENCODING_AES_KEY（43 位）

FastGPT 知识库（8443 默认拒绝所有人）：
  1. 把运维公网 IP 写入 FASTGPT_ADMIN_ALLOW_CIDRS，例如 203.0.113.20/32
  2. sudo ./deploy/install.sh
  3. 浏览器打开 https://${domain}:8443 ，用户名 root，口令是向导生成的 FASTGPT_ROOT_PASSWORD
  4. 建好应用后，把 API Key 写入 FASTGPT_API_KEY
  5. docker compose --env-file .env -f deploy/docker-compose.yml up -d adapter

以后要改什么，改哪里，改完执行什么（都在 /opt/cs-bot 下）：
  换应用 Secret          改 WECHAT_AGENT_SECRET，并 up -d adapter。旧 Secret 立即不能用来发消息。
  换接收消息 Token       企微后台和 WECHAT_TOKEN 一起改，再 up -d adapter。只改一边则消息进不来。
  换 EncodingAESKey      企微后台和 WECHAT_ENCODING_AES_KEY 一起改，必须 43 位，再 up -d adapter。
  换企业或应用           同时改 WECHAT_CORP_ID、WECHAT_AGENT_ID、WECHAT_AGENT_SECRET，再 up -d adapter。
  换大模型 Key           改 LLM_PRIMARY_API_KEY 或 LLM_FALLBACK_API_KEY，再 up -d adapter。
  换知识库应用 Key       改 FASTGPT_API_KEY，再 up -d adapter。占位符不换成真实 Key 时问答失败。
  换管理口令             在运营台「用户」页改密码，或用 bootstrap-admin-user.sh 重建首个 admin。
  换数据库口令           不能只改 POSTGRES_PASSWORD。库里的口令是第一次启动时写入的。
  换 FastGPT 登录口令    不能只改 FASTGPT_ROOT_PASSWORD。它只在第一次初始化时成为 root 口令。
  换文件令牌             改 FASTGPT_FILE_TOKEN 会使已有文件链接失效，再 up -d fastgpt。
  放开或收紧 8443        改 FASTGPT_ADMIN_ALLOW_CIDRS，再 sudo ./deploy/install.sh。
  换 HTTPS 证书          替换 deploy/nginx/certs 下两个 pem，再 up -d nginx。企微回调依赖这张证书。
  Let's Encrypt 续期     系统定时 certbot renew；成功后 hook 自动覆盖 pem 并 up -d nginx。手动：sudo certbot renew
  重新申请 LE 证书       sudo ./deploy/issue-letsencrypt.sh issue <域名> [邮箱]
  换授权                 替换 license/license.lic 后，在管理接口执行授权重载，或 up -d adapter。

重新查看这份对照：./deploy/setup.sh --after
EOF
}

print_steps() {
  explain_env
  echo
  explain_wecom
  echo
  explain_llm
  echo
  explain_secrets
  echo
  explain_access
  echo
  explain_files
  echo
  explain_start
  echo
  print_after
}

step_env() {
  explain_env
  pause
  ensure_env
  local llm lic
  llm="$(ask "USE_MOCK_LLM，生产填 false" "false")"
  lic="$(ask "USE_MOCK_LICENSE，生产填 false" "false")"
  case "$llm" in
    true|false) ;;
    *) die "USE_MOCK_LLM 只能是 true 或 false" ;;
  esac
  case "$lic" in
    true|false) ;;
    *) die "USE_MOCK_LICENSE 只能是 true 或 false" ;;
  esac
  [ "$llm" = "true" ] && echo "已选择假答案。群里不会调用真实大模型。" >&2
  [ "$lic" = "true" ] && echo "已选择跳过授权验签。正式 license 不会生效。" >&2
  set_kv USE_MOCK_LLM "$llm"
  set_kv USE_MOCK_LICENSE "$lic"
}

step_wecom() {
  explain_wecom
  pause
  local corp agent secret token aes bot_id bot_name
  while true; do
    corp="$(ask "WECHAT_CORP_ID")"
    [[ "$corp" =~ ^[a-zA-Z0-9_-]{6,30}$ ]] && break
    echo "企业 ID 需为 6 到 30 位字母、数字、下划线或横线。" >&2
  done
  while true; do
    agent="$(ask "WECHAT_AGENT_ID")"
    [[ "$agent" =~ ^[0-9]+$ ]] && break
    echo "AgentId 是纯数字。" >&2
  done
  while true; do
    secret="$(ask "WECHAT_AGENT_SECRET")"
    [ "${#secret}" -ge 8 ] && break
    echo "Secret 至少 8 位。" >&2
  done
  while true; do
    token="$(ask "WECHAT_TOKEN")"
    [ "${#token}" -ge 3 ] && break
    echo "Token 至少 3 位。" >&2
  done
  while true; do
    aes="$(ask "WECHAT_ENCODING_AES_KEY")"
    [ "${#aes}" -eq 43 ] && break
    echo "EncodingAESKey 当前 ${#aes} 位，必须正好 43 位。" >&2
  done
  bot_id="$(ask "WECHAT_BOT_USER_ID，可留空" "" 1)"
  bot_name="$(ask "WECHAT_BOT_NAME，可留空" "" 1)"
  set_kv WECHAT_CORP_ID "$corp"
  set_kv WECHAT_AGENT_ID "$agent"
  set_kv WECHAT_AGENT_SECRET "$secret"
  set_kv WECHAT_TOKEN "$token"
  set_kv WECHAT_ENCODING_AES_KEY "$aes"
  set_kv WECHAT_BOT_USER_ID "$bot_id"
  set_kv WECHAT_BOT_NAME "$bot_name"
}

step_llm() {
  explain_llm
  pause
  local primary fallback
  while true; do
    primary="$(ask "LLM_PRIMARY_API_KEY")"
    [ "${#primary}" -ge 8 ] && break
    echo "主模型 Key 至少 8 位。" >&2
  done
  while true; do
    fallback="$(ask "LLM_FALLBACK_API_KEY")"
    [ "${#fallback}" -ge 8 ] && break
    echo "备用模型 Key 至少 8 位。" >&2
  done
  set_kv LLM_PRIMARY_BASE_URL "https://api.deepseek.com/v1"
  set_kv LLM_PRIMARY_API_KEY "$primary"
  set_kv LLM_FALLBACK_BASE_URL "https://dashscope.aliyuncs.com/compatible-mode/v1"
  set_kv LLM_FALLBACK_API_KEY "$fallback"
  set_kv MOCK_MEDIA_RECOGNIZE "true"
}

step_secrets() {
  explain_secrets
  pause
  local admin_user admin_pass pg rootp file
  admin_user="$(ask "运营台首个管理员用户名（建议 admin）")"
  [[ -n "$admin_user" ]] || admin_user="admin"
  while true; do
    admin_pass="$(ask "运营台首个管理员密码（≥8 位）")"
    [ "${#admin_pass}" -ge 8 ] && break
    echo "管理员密码至少 8 位。" >&2
  done
  pg="$(openssl rand -hex 24)"
  rootp="$(openssl rand -hex 24)"
  file="$(openssl rand -hex 24)"
  cat <<EOF

请立刻抄写，关闭终端后脚本不会再打印：
  CONSOLE_ADMIN_USER=$admin_user
  CONSOLE_ADMIN_PASSWORD=$admin_pass
  POSTGRES_PASSWORD=$pg
  FASTGPT_ROOT_PASSWORD=$rootp
  FASTGPT_FILE_TOKEN=$file
  REDIS_PASSWORD=
EOF
  pause
  printf '%s\n' "$admin_user" > "$ROOT/.setup-admin-user"
  printf '%s\n' "$admin_pass" > "$ROOT/.setup-admin-password"
  chmod 600 "$ROOT/.setup-admin-user" "$ROOT/.setup-admin-password" 2>/dev/null || true
  set_kv POSTGRES_PASSWORD "$pg"
  set_kv FASTGPT_ROOT_PASSWORD "$rootp"
  set_kv FASTGPT_FILE_TOKEN "$file"
  set_kv REDIS_PASSWORD ""
  set_kv FASTGPT_BASE_URL "http://fastgpt:3000"
  set_kv FASTGPT_API_KEY "fastgpt-pending-key"
}

step_access() {
  explain_access
  pause
  local domain ips cidrs region image
  while true; do
    domain="$(ask "对外域名，例如 bot.example.com")"
    case "$domain" in
      *[!a-zA-Z0-9.-]*|"") echo "域名只含字母、数字、点和横线。" >&2 ;;
      *) break ;;
    esac
  done
  printf '%s\n' "$domain" > "$DOMAIN_FILE"
  chmod 600 "$DOMAIN_FILE"
  while true; do
    ips="$(ask "ALLOWED_ADMIN_IPS，例如 203.0.113.20/32")"
    case "$ips" in
      */*) break ;;
      *) echo "写成 IP/掩码，多个网段用英文逗号分隔。" >&2 ;;
    esac
  done
  cidrs="$(ask "FASTGPT_ADMIN_ALLOW_CIDRS，现在可留空" "" 1)"
  region="$(ask "镜像地域：1 国内，2 海外" "1")"
  case "$region" in
    2) image="$FASTGPT_IMAGE_OS" ;;
    *) image="$FASTGPT_IMAGE_CN" ;;
  esac
  set_kv ALLOWED_ADMIN_IPS "$ips"
  set_kv FASTGPT_ADMIN_ALLOW_CIDRS "$cidrs"
  set_kv FASTGPT_ADMIN_PORT "8443"
  set_kv FASTGPT_IMAGE "$image"
}

place_one() {
  local label="$1" dest="$2" mode="$3" src
  if [ -f "$dest" ]; then
    src="$(ask "$label 已在 $(basename "$dest")。要替换请输入新文件路径，否则直接回车" "" 1)"
  else
    src="$(ask "$label 的文件路径")"
  fi
  if [ -n "$src" ]; then
    copy_into "$src" "$dest" "$mode"
    echo "已放入 $dest" >&2
  fi
  [ -f "$dest" ] || die "仍缺少 $dest"
}

step_tls_certs() {
  local mode domain email
  domain=""
  if [ -f "$DOMAIN_FILE" ]; then
    domain="$(tr -d '[:space:]' < "$DOMAIN_FILE")"
  fi
  cat <<'EOF' >&2
站点 TLS（企微要求公网可信任证书，勿用 openssl 自签）：
  1  Let's Encrypt 申请（域名须已解析到本机，建议在启动 nginx 前做；约 90 天自动续期）
  2  已有 fullchain.pem / privkey.pem，按路径拷入
EOF
  mode="$(ask "选证书方式" "1")"
  case "$mode" in
    1)
      [ -n "$domain" ] || domain="$(ask "申请证书的域名，例如 bot.example.com")"
      email="$(ask "联系邮箱（可留空，Let's Encrypt 到期提醒）" "" 1)"
      if [ "$(id -u)" != "0" ]; then
        die "Let's Encrypt 需要 root。请执行: sudo ./deploy/setup.sh 或 sudo ./deploy/issue-letsencrypt.sh issue $domain ${email}"
      fi
      if [ -n "$email" ]; then
        "$ROOT/deploy/issue-letsencrypt.sh" issue "$domain" "$email"
      else
        "$ROOT/deploy/issue-letsencrypt.sh" issue "$domain"
      fi
      ;;
    *)
      place_one "fullchain.pem" "$ROOT/deploy/nginx/certs/fullchain.pem" 644
      place_one "privkey.pem" "$ROOT/deploy/nginx/certs/privkey.pem" 600
      ;;
  esac
  [ -f "$ROOT/deploy/nginx/certs/fullchain.pem" ] || die "仍缺少 fullchain.pem"
  [ -f "$ROOT/deploy/nginx/certs/privkey.pem" ] || die "仍缺少 privkey.pem"
}

step_files() {
  explain_files
  pause
  step_tls_certs
  place_one "license.lic" "$ROOT/license/license.lic" 600
}

step_start() {
  explain_start
  pause
  "$ROOT/deploy/build-images.sh"
  "$ROOT/deploy/install.sh" --check
  if [ "$(id -u)" != "0" ]; then
    cat <<'EOF'
配置和预检已完成。当前不是 root，目录归属还没校正。
请执行：
  sudo ./deploy/install.sh
EOF
    print_after
    return 0
  fi
  "$ROOT/deploy/install.sh"
  if [ -f "$ROOT/.setup-admin-user" ] && [ -f "$ROOT/.setup-admin-password" ]; then
    local au ap hash
    au="$(tr -d '\n' < "$ROOT/.setup-admin-user" | tr '[:upper:]' '[:lower:]')"
    ap="$(tr -d '\n' < "$ROOT/.setup-admin-password")"
    echo "写入运营台首个管理员到数据库…"
    # shellcheck disable=SC1090
    set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a
    hash="$(node "$ROOT/scripts/hash-admin-password.mjs" "$ap" | tr -d '\n')"
    if docker compose --env-file "$ENV_FILE" -f "$ROOT/deploy/docker-compose.yml" exec -T pg \
      psql -U "${POSTGRES_USER:-cs}" -d "${POSTGRES_DB:-csbot}" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO admin_role (code, name) VALUES ('admin', 'Administrator'), ('operator', 'Operator')
ON CONFLICT (code) DO NOTHING;
INSERT INTO admin_user (id, username, password_hash, role_code, enabled)
SELECT gen_random_uuid(), '$au', '$hash', 'admin', TRUE
WHERE NOT EXISTS (SELECT 1 FROM admin_user WHERE role_code='admin' AND enabled=TRUE);
SQL
    then
      echo "首个管理员已写入：$au"
    else
      echo "[setup] WARN: 自动写入管理员失败，请手动：DATABASE_URL=... ./scripts/bootstrap-admin-user.sh --user $au --password '***'" >&2
    fi
    rm -f "$ROOT/.setup-admin-user" "$ROOT/.setup-admin-password"
  fi
  print_after
}

run_wizard() {
  require_tty
  cd "$ROOT"
  echo "分步部署。共 8 步。每步先说明作用和影响，再填写。install.sh 本身不会提问。"
  if [ -f "$ENV_FILE" ]; then
    local choice
    choice="$(ask "已有 .env。1 重新填写，2 只放证书并启动，3 只看企微对照" "3")"
    case "$choice" in
      1) ;;
      2) step_files; step_start; return 0 ;;
      *) print_after; return 0 ;;
    esac
  fi
  step_env
  step_wecom
  step_llm
  step_secrets
  step_access
  step_files
  step_start
}

case "${1:-}" in
  --steps) print_steps ;;
  --after) print_after ;;
  -h|--help)
    sed -n '2,8p' "$0"
    ;;
  "") run_wizard ;;
  *) die "未知参数: $1。可用 --steps、--after、--help" ;;
esac
