/**
 * 测试 helpers：ConfigService 单例注入 + 内存 Redis mock factory
 */
import { ConfigService } from '../../src/config/config.service.js';

/** 所有 config schema 字段，default 部分使用 schema 中的默认值 */
export const MOCK_CONFIG = {
  WECHAT_CORP_ID: 'test_corp_12345678',
  WECHAT_AGENT_ID: 1000001,
  WECHAT_AGENT_SECRET: 'test_secret_abcdefgh',
  WECHAT_TOKEN: 'test_token_abc',
  WECHAT_ENCODING_AES_KEY: 'abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG',
  FASTGPT_BASE_URL: 'https://fastgpt.example.com/api',
  FASTGPT_API_KEY: 'fastgpt_test_key_abcdefgh',
  FASTGPT_DATASET_IDS: 'dataset1,dataset2',
  LLM_PRIMARY_BASE_URL: 'https://api.openai.com/v1',
  LLM_PRIMARY_API_KEY: 'sk-test-primary-key-abcdefgh',
  LLM_FALLBACK_BASE_URL: 'https://api.anthropic.com/v1',
  LLM_FALLBACK_API_KEY: 'sk-test-fallback-key-ijklmnop',
  LLM_TIMEOUT_MS: 15000,
  LLM_RETRY_DELAY_MS: 0,
  LLM_PRIMARY_MODEL: 'deepseek-chat',
  ADMIN_USER: 'admin',
  ADMIN_PASSWORD: 'secret123',
  ALLOWED_ADMIN_IPS: '127.0.0.1/32,10.0.0.0/24',
  USE_MOCK_LLM: true,
  USE_MOCK_LICENSE: true,
  USAGE_REPORT_ENABLED: false,
  CONFIDENCE_THRESHOLD: 0.75,
  CONTEXT_ROUNDS: 5,
  CONTEXT_TTL_SEC: 600,
  MISS_RECORD_RETENTION_DAYS: 90,
  SLOW_REPLY_TEXT: '系统繁忙，请稍后再试',
  REFUSAL_TEXT: '暂时没有合适答案，已记录到工单',
  QUESTION_GUIDANCE_TEXT: '请用一句完整的话描述您想咨询的问题～',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: 6379,
  REDIS_PASSWORD: '',
  REDIS_DB: 0,
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
  LICENSE_FILE: '/tmp/test-license.lic',
  RATE_GROUP_PER_MIN: 20,
  RATE_USER_PER_MIN: 5,
  RATE_HINT_TEXT: '提问太频繁，请稍后再试',
  ALLOWED_CHAT_IDS: '',
  REQUIRE_GROUP_CHAT_ID: false,
  REPLY_QUEUE_ENABLED: true,
  REPLY_QUEUE_MAX: 100,
  REPLY_QUEUE_WAIT_TIMEOUT_MS: 60_000,
  REPLY_QUEUE_HINT_TEXT: '问题较多，请稍后再试～',
  LLM_CONCURRENCY: 4,
  WECOM_CONCURRENCY: 8,
  WECOM_SEND_MAX_ATTEMPTS: 3,
  WECOM_SEND_BACKOFF_MS: 0,
  WECOM_SEND_BACKOFF_MAX_MS: 0,
  VL_CONCURRENCY: 2,
  MAX_SEGMENT_BYTES: 2048,
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  SEGMENT_SAFE_BYTES: 2000,
  SEGMENT_GAP_MS: 300,
  PORT: 3000,
  HOST: '0.0.0.0',
  MOCK_QA_FILE: '',
  KEYWORDS_FILE: '',
  WECHAT_BOT_USER_ID: '',
  WECHAT_BOT_NAME: '',
  LOG_LEVEL: 'info',
  SWAGGER_ENABLED: true,
  IMPORT_MAX_FILE_BYTES: 200 * 1024 * 1024,
  IMPORT_MAX_FILE_BYTES_URL: 200 * 1024 * 1024,
  IMPORT_MAX_MESSAGES: 50000,
  IMPORT_MEMORY_LIMIT_MB: 4096,
  PLATFORM_ENABLED: false,
  PLATFORM_COMPOSE_DIR: 'data/tenants',
  PLATFORM_PROVISION_TIMEOUT_MS: 120000,
  PLATFORM_TLS_PROVIDER: 'fake',
  PLATFORM_CERT_CMD: '',
  PLATFORM_CERT_DIR: 'data/tenants/certs',
  LICENSE_ISSUER: 'noop',
  LICENSE_ISSUER_BIN: 'tools/license-issuer/license-issuer',
  LICENSE_ISSUER_KEY: '',
  LICENSE_ISSUER_OUT_DIR: 'data/licenses',
  PLATFORM_HEALTH_URL_TEMPLATE: 'http://{host}/healthz',
  PLATFORM_UPGRADE_SCRIPT: 'scripts/tenant-upgrade.sh',
  PLATFORM_CANARY_OBSERVE_MS: 0,
  MODEL_MODE: 'cloud',
  LOCAL_LLM_BASE_URL: '',
  LOCAL_LLM_API_KEY: '',
  LOCAL_LLM_MODEL: '',
  LOCAL_LLM_TIMEOUT_MS: 25000,
  LOCAL_EMBEDDING_URL: '',
  TENANT_ID: '',
  CONTROL_PLANE_URL: '',
  CONTROL_PLANE_TOKEN: '',
} satisfies Record<string, unknown>;

export function setConfig(overrides: Partial<Record<string, unknown>> = {}): void {
  (ConfigService as any)._instance = { ...MOCK_CONFIG, ...overrides };
}

export function resetConfig(): void {
  (ConfigService as any)._instance = undefined;
}

/** 内存 Map-backed Redis mock */
export function createRedisMock(): any {
  const store = new Map<string, string>();
  const expiry = new Map<string, number>();

  function evict(key: string): boolean {
    const t = expiry.get(key);
    if (t !== undefined && Date.now() > t) { store.delete(key); expiry.delete(key); return true; }
    return false;
  }

  return {
    store,
    incr: (key: string): Promise<number> => {
      evict(key);
      const n = (parseInt(store.get(key) ?? '0', 10) + 1);
      store.set(key, String(n));
      return Promise.resolve(n);
    },
    set: (key: string, val: string, ...args: string[]): Promise<string | null> => {
      const nxIdx = args.indexOf('NX');
      if (nxIdx >= 0) {
        evict(key);
        if (store.has(key)) return Promise.resolve(null);
        store.set(key, val);
        const exIdx = args.indexOf('EX');
        if (exIdx >= 0) expiry.set(key, Date.now() + parseInt(args[exIdx + 1], 10) * 1000);
        return Promise.resolve('OK');
      }
      store.set(key, val);
      const exIdx = args.indexOf('EX');
      if (exIdx >= 0) expiry.set(key, Date.now() + parseInt(args[exIdx + 1], 10) * 1000);
      return Promise.resolve('OK');
    },
    get: (key: string): Promise<string | null> => {
      evict(key);
      return Promise.resolve(store.get(key) ?? null);
    },
    del: (key: string): Promise<number> => {
      const existed = store.has(key);
      store.delete(key); expiry.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    },
    multi: function () {
      const pending: Array<() => any> = [];
      const self = this as any;
      return {
        set: (k: string, v: string, ...a: string[]) => { pending.push(() => self.set(k, v, ...a)); return this; },
        incr: (k: string) => { pending.push(() => self.incr(k)); return this; },
        exec: () => Promise.resolve(pending.splice(0).map((fn) => [null, fn()])),
      };
    },
  };
}
