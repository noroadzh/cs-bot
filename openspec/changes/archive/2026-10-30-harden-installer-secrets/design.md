# Design

## Context

见 proposal.md。`install.sh` 已有 preflight（docker/compose/.env/证书/license/镜像/宿主内存），`missing[]` 汇聚后统一失败；交付包由 `package-delivery.sh` 生成并附 `SHA256SUMS.txt`。

## Goals / Non-Goals

**Goals:**

- 完整性不通过则不启动任何容器。
- 弱口令在安装前被发现，而不是上线后由安全自查兜底。

**Non-Goals:**

- 不改 compose 的 dev 默认值（本地开发便利），由安装器在生产路径兜底。
- 不做口令复杂度评分，只做长度 + 已知弱值黑名单。
- 不改包生成逻辑（校验和已存在）。

## Decisions

### D1 校验和

```bash
verify_checksums() {
  local f="$ROOT/SHA256SUMS.txt"
  [ -f "$f" ] || { warn "未找到 SHA256SUMS.txt，跳过完整性校验（自建包）"; return; }
  local hash="sha256sum"; command -v sha256sum >/dev/null 2>&1 || hash="shasum -a 256"
  local out
  if ! out="$(cd "$ROOT" && $hash -c SHA256SUMS.txt 2>&1)"; then
    echo "$out" | grep -E 'FAILED|失败' | head -20 | while read -r line; do
      missing+=("完整性校验失败: $line")
    done
    [ "${#missing[@]}" -gt 0 ] || missing+=("完整性校验失败（详见 $f）")
  fi
}
```

- 在 `preflight` 末尾调用；`--check`/`install` 缺项即失败，`--dry-run` 仅 WARN。
- `sha256sum -c` 在 macOS 不可用，回退 `shasum -a 256 -c`。

### D2 强口令

```bash
WEAK_SECRETS="cs postgres password 123456 fastgpt123456 filetoken1234567890 please_change_me admin redis test changeme"
check_secret ADMIN_PASSWORD required
check_secret POSTGRES_PASSWORD required
check_secret FASTGPT_ROOT_PASSWORD required
check_secret REDIS_PASSWORD optional
```

规则：required 缺失 → 缺项；填写值长度 <12 或在弱值黑名单 → `弱口令: KEY`。README/手册给 `openssl rand -base64 24` 示例。

### D3 模板与文档

- `.env.template`：`ADMIN_PASSWORD=`（空）+ 注释；补 `POSTGRES_PASSWORD=`、`FASTGPT_ROOT_PASSWORD=` 注释「必填强口令」。
- `deploy/.env.template`：同样加注释与空值。
- 部署手册 §7.0/§7.3 提示；概设 §9 日志脱敏表述改为「全级别脱敏」。

## Risks / Trade-offs

- [存量部署重跑被弱口令拦住] → 这是期望行为；提示信息给出生成命令，改完 `.env` 重跑即可。
- [自建包无 SHA256SUMS] → 仅 WARN，不阻断。
- [口令写在命令行历史] → 文档示例用 `openssl rand` 写入 .env，不经过命令行参数。

## Migration Plan

1. 升级安装器后首次运行会检查现有 `.env`；弱口令需先替换。
2. 回滚：恢复上一版 `install.sh` 即可，无数据变更。

## Verification

- `install-script.spec.ts`：校验和不匹配 → 非零并列出文件；弱口令 → 非零并命名 KEY；强口令 + 无 SHA 文件 → `--dry-run` 通过。
- `bash -n`；全量单测/集成/验收通过。
