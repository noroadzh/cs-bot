/**
 * TenantSecretsService：生成幂等、加密持久化、客户密钥合并、env 文件权限
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TenantSecretStore } from '../src/platform/tenant-secret-store.js';
import { TenantSecretsService, GENERATED_SECRET_KEYS } from '../src/platform/tenant-secrets.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

let dir: string;
let svc: TenantSecretsService;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'csbot-secrets-'));
  setConfig();
  svc = new TenantSecretsService(new TenantSecretStore('test-master-key-123456'), dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  resetConfig();
});

describe('TenantSecretsService', () => {
  it('首次生成平台密钥，重复 ensure 复用同一组值', async () => {
    const a = await svc.ensure('t-secret-1');
    const first = await svc.load('t-secret-1');
    for (const k of GENERATED_SECRET_KEYS) expect(first[k]).toBeTruthy();

    const b = await svc.ensure('t-secret-1');
    const second = await svc.load('t-secret-1');
    expect(second.POSTGRES_PASSWORD).toBe(first.POSTGRES_PASSWORD);
    expect(second.REDIS_PASSWORD).toBe(first.REDIS_PASSWORD);
    expect(a.secretsRef).toBe(b.secretsRef);
  });

  it('secrets.enc 加密存储，tenant.env 600', async () => {
    await svc.ensure('t-secret-2');
    const enc = await readFile(join(dir, 't-secret-2', 'secrets.enc'), 'utf8');
    expect(enc).not.toContain('POSTGRES_PASSWORD');
    expect((await stat(join(dir, 't-secret-2', 'secrets.enc'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 't-secret-2', 'tenant.env'))).mode & 0o777).toBe(0o600);
  });

  it('合并客户提供密钥（白名单），忽略未知键', async () => {
    await svc.ensure('t-secret-3');
    const updated = await svc.update('t-secret-3', {
      WECHAT_CORP_ID: 'ww123',
      FASTGPT_API_KEY: 'fg-key',
      UNKNOWN_KEY: 'ignored',
    });
    expect(updated.sort()).toEqual(['FASTGPT_API_KEY', 'WECHAT_CORP_ID']);
    const bundle = await svc.load('t-secret-3');
    expect(bundle.WECHAT_CORP_ID).toBe('ww123');
    expect(bundle.FASTGPT_API_KEY).toBe('fg-key');
    expect(bundle.UNKNOWN_KEY).toBeUndefined();
    const env = await readFile(join(dir, 't-secret-3', 'tenant.env'), 'utf8');
    expect(env).toContain('WECHAT_CORP_ID=ww123');
  });
});
