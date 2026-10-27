/**
 * 独立控制面配置（不含数据面企微/LLM 凭证）
 */
import { z } from 'zod';
import { EnvString, EnvInt, EnvBool, preprocessEnv } from '@cs-bot/shared';

export const ControlPlaneConfigSchema = z.preprocess(preprocessEnv, z.object({
  DATABASE_URL: EnvString.min(1),
  HOST: EnvString.default('0.0.0.0'),
  PORT: EnvInt(3100),

  ADMIN_USER: EnvString.default('admin'),
  ADMIN_PASSWORD: EnvString.min(6),
  ALLOWED_ADMIN_IPS: EnvString.default('127.0.0.1/32'),

  PLATFORM_ENABLED: EnvBool(true),
  PLATFORM_COMPOSE_DIR: EnvString.default('data/tenants'),
  PLATFORM_PROVISION_TIMEOUT_MS: EnvInt(120000),
  PLATFORM_MASTER_KEY: EnvString.optional().default(''),
  PLATFORM_TLS_PROVIDER: EnvString.default('file'),
  PLATFORM_CERT_DIR: EnvString.default('data/certs'),
  PLATFORM_CERT_CMD: EnvString.optional().default(''),
  LICENSE_ISSUER: EnvString.default('shell'),
  LICENSE_ISSUER_BIN: EnvString.default('/app/tools/license-issuer/license-issuer.mjs'),
  LICENSE_ISSUER_KEY: EnvString.optional().default(''),
  LICENSE_ISSUER_OUT_DIR: EnvString.default('data/licenses'),
  PLATFORM_LICENSE_FINGERPRINT: EnvString.optional().default(''),
  PLATFORM_HEALTH_URL_TEMPLATE: EnvString.default('http://{host}/healthz'),
  PLATFORM_TENANT_CONTROL_PLANE_URL: EnvString.optional().default('http://host.docker.internal:3100'),
  PLATFORM_SHARED_NETWORK: EnvString.default('csbot-control'),
  PLATFORM_INSTANCE_SCHEME: EnvString.default('https'),
  PLATFORM_VERIFY_TLS: EnvBool(true),
  PLATFORM_INSTANCE_TIMEOUT_MS: EnvInt(8000),
  PLATFORM_UPGRADE_SCRIPT: EnvString.default('/app/scripts/tenant-upgrade.sh'),
  PLATFORM_CANARY_OBSERVE_MS: EnvInt(86_400_000),
  PLATFORM_UPGRADE_CANARY_ID: EnvString.optional().default(''),

  OPS_WEBHOOK_URL: EnvString.optional().default(''),
  CONTROL_PLANE_TOKEN: EnvString.optional().default(''),

  LOG_LEVEL: EnvString.default('info'),
  LOG_FILE: EnvString.optional().default(''),
  SLOW_LOG_MS: EnvInt(2000),
}));

export type ControlPlaneConfig = z.infer<typeof ControlPlaneConfigSchema>;

export function loadControlPlaneConfig(env: NodeJS.ProcessEnv = process.env): ControlPlaneConfig {
  const result = ControlPlaneConfigSchema.safeParse(env);
  if (!result.success) {
    console.error('[control-plane] 配置校验失败：');
    console.error(JSON.stringify(result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })), null, 2));
    process.exit(1);
  }
  return result.data;
}
