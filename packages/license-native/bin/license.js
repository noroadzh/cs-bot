#!/usr/bin/env node
/**
 * license CLI —— MVP 阶段的 license 签发与自检工具
 *
 * 用法：
 *   license issue  --expires-at <ISO> | --days <N> [options]
 *   license verify [--file <path>]
 *
 * issue 选项：
 *   --expires-at <ISO>   过期时间，如 2026-12-31T23:59:59Z
 *   --days <N>           从现在起 N 天过期（与 --expires-at 二选一）
 *   --max-chats <N>      授权群数量上限，默认 100
 *   --fingerprint <hex>  绑定指纹；省略则取本机 fingerprint()
 *   --output <path>      输出路径，默认 license/license.lic
 *   --force              覆盖已存在的 license 文件
 *
 * 私钥约束（见 change C design §C.3）：
 *   MVP 阶段明文 PEM 存 test_keys/test_signing_key.pem。
 *   生产必须换 KMS/HSM —— 本工具的 PEM 路径不可用于生产签发。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_KEY = resolve(PKG_ROOT, 'test_keys/test_signing_key.pem');
const DEFAULT_OUT = 'license/license.lic';

function die(msg, code = 1) {
  process.stderr.write(`license: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** 加载 native 模块；失败给出可读错误而非未捕获异常。 */
function loadNative() {
  try {
    return require('@cs-bot/license-native');
  } catch (err) {
    die(
      `无法加载 license native 模块：${err.message}\n` +
        `  请确认 prebuilds/linux-x64-gnu/index.node 为 Linux ELF 产物，` +
        `或在 Linux 上运行 cargo build --release`,
    );
  }
}

function cmdIssue(args) {
  if (existsSync(DEFAULT_KEY) === false) {
    die(`找不到签名私钥 ${DEFAULT_KEY}`);
  }

  // 过期时间
  let expiresAtMs;
  if (args['expires-at']) {
    expiresAtMs = Date.parse(String(args['expires-at']));
    if (Number.isNaN(expiresAtMs)) die(`--expires-at 无法解析：${args['expires-at']}`);
  } else if (args.days) {
    expiresAtMs = Date.now() + Number(args.days) * 86400000;
  } else {
    die('必须提供 --expires-at <ISO> 或 --days <N>');
  }

  // 指纹
  let fingerprint;
  if (args.fingerprint) {
    fingerprint = String(args.fingerprint);
  } else {
    const native = loadNative();
    try {
      fingerprint = native.fingerprint();
    } catch (err) {
      die(`本机 fingerprint() 失败（${err.message}）。非 Linux 平台请显式传 --fingerprint`);
    }
  }

  const payload = {
    fingerprint,
    expires_at_ms: expiresAtMs,
    max_chats: Number(args['max-chats'] ?? 100),
    ts: Date.now(),
  };

  // 签名
  let signature;
  try {
    const key = createPrivateKey({
      key: readFileSync(DEFAULT_KEY),
      format: 'pem',
      type: 'pkcs8',
    });
    const payloadJson = JSON.stringify(payload);
    signature = cryptoSign(null, Buffer.from(payloadJson, 'utf8'), key);
  } catch (err) {
    die(`签名失败：${err.message}`);
  }

  const license = `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}.${signature.toString('base64')}`;

  const outPath = String(args.output ?? DEFAULT_OUT);
  if (existsSync(outPath) && !args.force) {
    die(`${outPath} 已存在。加 --force 覆盖`);
  }
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, license, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(
    `license 已签发 → ${outPath}\n` +
      `  fingerprint: ${fingerprint}\n` +
      `  expiresAt:   ${new Date(expiresAtMs).toISOString()}\n` +
      `  maxChats:   ${payload.max_chats}\n`,
  );
}

function cmdVerify(args) {
  const file = String(args.file ?? DEFAULT_OUT);
  if (!existsSync(file)) die(`找不到 license 文件 ${file}`);

  const raw = readFileSync(file, 'utf8').trim();
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0 || dotIdx === raw.length - 1) die(`license 格式错误（缺少 '.' 分隔）`);

  const payloadB64 = raw.slice(0, dotIdx);
  const sigB64 = raw.slice(dotIdx + 1);
  let payloadJson;
  try {
    payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
  } catch (err) {
    die(`payload base64 解码失败：${err.message}`);
  }

  const native = loadNative();
  let result;
  try {
    result = native.verify(payloadJson, sigB64);
  } catch (err) {
    die(`native verify 抛错：${err.message}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.valid ? 0 : 1);
}

function main() {
  const [, , cmd, ...rest] = process.argv;
  const args = parseArgs(rest);

  switch (cmd) {
    case 'issue':
      cmdIssue(args);
      break;
    case 'verify':
      cmdVerify(args);
      break;
    case undefined:
    case '--help':
    case '-h':
    case 'help':
      process.stdout.write(
        '用法：\n' +
          '  license issue  --expires-at <ISO> | --days <N> [--max-chats N] [--fingerprint hex] [--output path] [--force]\n' +
          '  license verify [--file path]\n',
      );
      break;
    default:
      die(`未知命令 ${cmd}`);
  }
}

main();