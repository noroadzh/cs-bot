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
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: 6379,
  REDIS_PASSWORD: '',
  REDIS_DB: 0,
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
  LICENSE_FILE: '/tmp/test-license.lic',
  RATE_GROUP_PER_MIN: 20,
  RATE_USER_PER_MIN: 5,
  MAX_SEGMENT_BYTES: 2048,
  SEGMENT_SAFE_BYTES: 2000,
  SEGMENT_GAP_MS: 300,
  PORT: 3000,
  HOST: '0.0.0.0',
  MOCK_QA_FILE: '',
  KEYWORDS_FILE: '',
  WECHAT_BOT_USER_ID: '',
  LOG_LEVEL: 'info',
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
