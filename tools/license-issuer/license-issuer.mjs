#!/usr/bin/env node
/**
 * 交付侧授权签发 CLI（仅交付方内部使用，不随运行时镜像分发）
 *
 * 用法：
 *   node license-issuer.mjs \
 *     --key issuer-private.pem \
 *     --fingerprint <sha256> \
 *     --expires 2027-10-11 \
 *     --max-chats 15 \
 *     [--license-id CSBOT-2026-001] [--out license.lic]
 *
 * 输出格式：base64(payload JSON) + "." + base64(Ed25519 signature)
 * 签名对象：payload JSON 的 UTF-8 字节（与 license-native verify 一致）。
 */
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export function buildPayload({ fingerprint, expiresAtMs, maxChats, licenseId = 'CSBOT', nowMs = Date.now() }) {
  return {
    payload: licenseId,
    fingerprint,
    expires_at_ms: expiresAtMs,
    max_chats: maxChats,
    ts: nowMs,
  };
}

export function issueLicense(payload, privateKeyPem) {
  const payloadJson = JSON.stringify(payload);
  const key = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(payloadJson, 'utf8'), key);
  return `${Buffer.from(payloadJson, 'utf8').toString('base64')}.${signature.toString('base64')}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k?.startsWith('--')) continue;
    out[k.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

function usage(msg) {
  if (msg) console.error(msg);
  console.error('usage: license-issuer.mjs --key <pem> --fingerprint <hash> --expires <ISO|ms> --max-chats <n> [--license-id id] [--out file]');
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.key || !args.fingerprint || !args.expires || !args['max-chats']) usage('missing required args');
  if (process.env.NODE_ENV === 'production' && String(args.key).includes('/test_keys/')) {
    console.error('refusing test signing key in production');
    process.exit(1);
  }
  const expiresRaw = args.expires;
  const expiresAtMs = /^\d+$/.test(expiresRaw) ? Number(expiresRaw) : Date.parse(expiresRaw);
  if (!Number.isFinite(expiresAtMs)) usage(`invalid --expires: ${expiresRaw}`);
  const payload = buildPayload({
    fingerprint: args.fingerprint,
    expiresAtMs,
    maxChats: Number(args['max-chats']),
    licenseId: args['license-id'] ?? 'CSBOT',
  });
  const license = issueLicense(payload, readFileSync(args.key, 'utf8'));
  if (args.out) {
    writeFileSync(args.out, license, { mode: 0o600 });
    console.log(args.out);
  } else {
    console.log(license);
  }
}

main();
