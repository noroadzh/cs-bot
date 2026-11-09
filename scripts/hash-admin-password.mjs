#!/usr/bin/env node
/** Hash admin password with same scrypt encoding as apps/adapter/src/admin/password-hasher.ts */
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const password = process.argv[2] ?? '';
if (!password || password.length < 8) {
  console.error('usage: hash-admin-password.mjs <password>=8chars');
  process.exit(1);
}
const salt = randomBytes(16);
const derived = await scrypt(password, salt, 32, { N: 16384, r: 8, p: 1 });
process.stdout.write(
  `scrypt$16384$8$1$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}\n`,
);
