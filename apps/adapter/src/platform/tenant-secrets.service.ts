/**
 * TenantSecretsService — 租户密钥生成/持久化（与 compose 渲染解耦）
 *
 * 原则：
 * - 平台生成类密钥（DB/Redis/管理员/FastGPT 根口令等）只在首次 ensure 时生成，
 *   重试/重开沿用 secrets.enc，避免轮换导致实例与库不一致。
 * - 客户提供类密钥（企微/LLM/FastGPT API Key）通过 update 合并，永不写日志。
 * - 渲染器只消费 tenant.env，不接触加密文件与生成逻辑。
 */
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigService } from '../config/config.service.js';
import { TenantSecretStore } from './tenant-secret-store.js';

export const GENERATED_SECRET_KEYS = [
  'POSTGRES_PASSWORD',
  'ADMIN_PASSWORD',
  'REDIS_PASSWORD',
  'FASTGPT_ROOT_PASSWORD',
  'FASTGPT_FILE_TOKEN',
  'FASTGPT_TOKEN_KEY',
  'FASTGPT_ROOT_KEY',
  'TENANT_SYNC_TOKEN',
] as const;

export const PROVIDED_SECRET_KEYS = [
  'WECHAT_CORP_ID',
  'WECHAT_AGENT_ID',
  'WECHAT_AGENT_SECRET',
  'WECHAT_TOKEN',
  'WECHAT_ENCODING_AES_KEY',
  'WECHAT_BOT_USER_ID',
  'WECHAT_BOT_NAME',
  'FASTGPT_BASE_URL',
  'FASTGPT_API_KEY',
  'FASTGPT_DATASET_IDS',
  'FASTGPT_ROOT_PASSWORD',
  'LLM_PRIMARY_BASE_URL',
  'LLM_PRIMARY_API_KEY',
  'LLM_FALLBACK_BASE_URL',
  'LLM_FALLBACK_API_KEY',
  'OPS_WEBHOOK_URL',
  'CONTROL_PLANE_URL',
  'CONTROL_PLANE_TOKEN',
] as const;

export type TenantSecrets = Record<string, string>;

export interface TenantSecretsResult {
  envFile: string;
  secretsRef: string;
  keys: string[];
}

function quoteEnv(value: string): string {
  if (value === '') return '';
  return /[\s#"']/.test(value) ? JSON.stringify(value) : value;
}

@Injectable()
export class TenantSecretsService {
  constructor(
    private readonly store: TenantSecretStore,
    private readonly rootDir = ConfigService.instance.PLATFORM_COMPOSE_DIR,
  ) {}

  private dir(tenantId: string): string {
    return join(this.rootDir, tenantId);
  }

  private secretsPath(tenantId: string): string {
    return join(this.dir(tenantId), 'secrets.enc');
  }

  envPath(tenantId: string): string {
    return join(this.dir(tenantId), 'tenant.env');
  }

  async ensure(tenantId: string): Promise<TenantSecretsResult> {
    const bundle = await this.load(tenantId);
    for (const key of GENERATED_SECRET_KEYS) {
      if (!bundle[key]) bundle[key] = randomBytes(24).toString('base64url');
    }
    // 数据面云模式：无需本地 LLM key；FastGPT key 由运营在 FastGPT 初始化后更新
    bundle.FASTGPT_API_KEY ??= 'change-me-fastgpt-key';
    bundle.CONTROL_PLANE_URL ??= ConfigService.instance.PLATFORM_TENANT_CONTROL_PLANE_URL ?? '';
    bundle.CONTROL_PLANE_TOKEN ??= ConfigService.instance.CONTROL_PLANE_TOKEN ?? '';
    await this.save(tenantId, bundle);
    return { envFile: this.envPath(tenantId), secretsRef: this.secretsPath(tenantId), keys: Object.keys(bundle) };
  }

  /** 合并客户提供密钥（白名单），返回已更新键名（不返回值） */
  async update(tenantId: string, patch: Record<string, unknown>): Promise<string[]> {
    const bundle = await this.load(tenantId);
    const updated: string[] = [];
    for (const key of PROVIDED_SECRET_KEYS) {
      const v = patch[key];
      if (typeof v === 'string' && v !== '') {
        bundle[key] = v;
        updated.push(key);
      }
    }
    await this.save(tenantId, bundle);
    return updated;
  }

  /** 开通前必填的客户密钥（FastGPT/LLM 由 FastGPT 侧持有） */
  async missingRequired(tenantId: string): Promise<string[]> {
    const bundle = await this.load(tenantId);
    return ['WECHAT_CORP_ID', 'WECHAT_AGENT_ID', 'WECHAT_AGENT_SECRET', 'WECHAT_TOKEN', 'WECHAT_ENCODING_AES_KEY']
      .filter((k) => !bundle[k]);
  }

  async load(tenantId: string): Promise<TenantSecrets> {
    try {
      return JSON.parse(this.store.decrypt(await readFile(this.secretsPath(tenantId), 'utf8'))) as TenantSecrets;
    } catch {
      return {};
    }
  }

  private async save(tenantId: string, bundle: TenantSecrets): Promise<void> {
    const dir = this.dir(tenantId);
    await mkdir(dir, { recursive: true });
    await writeFile(this.secretsPath(tenantId), this.store.encrypt(JSON.stringify(bundle)), { mode: 0o600 });
    const lines = [
      `TENANT_ID=${tenantId}`,
      'PLATFORM_ENABLED=false',
      'REQUIRE_GROUP_CHAT_ID=true',
      'USE_MOCK_LLM=false',
      'USE_MOCK_LICENSE=false',
      'MODEL_MODE=cloud',
      'LLM_PRIMARY_BASE_URL=http://fastgpt:3000/v1',
      'LLM_PRIMARY_API_KEY=unused-by-fastgpt',
      'LLM_FALLBACK_BASE_URL=http://fastgpt:3000/v1',
      'LLM_FALLBACK_API_KEY=unused-by-fastgpt',
      'LICENSE_FILE=/app/license/license.lic',
      ...Object.entries(bundle).map(([k, v]) => `${k}=${quoteEnv(v)}`),
    ];
    await writeFile(this.envPath(tenantId), lines.join('\n') + '\n', { mode: 0o600 });
  }
}
