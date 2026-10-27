/**
 * 签发 CLI：产物格式 + Ed25519 验签 + 不进入运行时镜像
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const execFileP = promisify(execFile);
const ROOT = join(process.cwd(), '..', '..');
const CLI = join(ROOT, 'tools', 'license-issuer', 'license-issuer.mjs');
let dir: string;

beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'csbot-issuer-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('license-issuer', () => {
  it('签发产物可被 Ed25519 公钥验证，且格式为 base64.base64', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const keyPath = join(dir, 'private.pem');
    await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
    const out = join(dir, 'license.lic');

    await execFileP('node', [CLI, '--key', keyPath, '--fingerprint', 'fp-123', '--expires', '2027-10-11', '--max-chats', '15', '--out', out]);
    const license = (await readFile(out, 'utf8')).trim();
    const [payloadB64, sigB64] = license.split('.');
    expect(payloadB64).toBeTruthy();
    expect(sigB64).toBeTruthy();

    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson);
    expect(payload).toMatchObject({ fingerprint: 'fp-123', max_chats: 15 });
    expect(typeof payload.expires_at_ms).toBe('number');
    expect(verify(null, Buffer.from(payloadJson, 'utf8'), publicKey, Buffer.from(sigB64, 'base64'))).toBe(true);
  });

  it('运行时 Dockerfile 不复制 tools/', async () => {
    const dockerfile = await readFile(join(ROOT, 'deploy', 'Dockerfile.adapter'), 'utf8');
    expect(dockerfile).not.toContain('tools/license-issuer');
  });
});
