/**
 * ConfigService 配置加载单元测试
 *
 * 策略：AppConfigSchema.safeParse 是真正的 fail-fast 校验逻辑，
 * 此 suite 直接测 schema（不调用 ConfigService.onModuleInit，避免 process.exit(1)）。
 */
import { describe, it, expect } from '@jest/globals';
import { AppConfigSchema } from '../src/config/config.schema.js';

const validEnv: Record<string, unknown> = {
  WECHAT_CORP_ID: 'ww1234567890abcdef',
  WECHAT_AGENT_ID: 1000001,
  WECHAT_AGENT_SECRET: 'test_secret_abcdefgh',
  WECHAT_TOKEN: 'TokenTest',
  WECHAT_ENCODING_AES_KEY: 'A'.repeat(43),
  FASTGPT_BASE_URL: 'https://fastgpt.example.com',
  FASTGPT_API_KEY: 'fastgpt-mock-key-1234',
  LLM_PRIMARY_BASE_URL: 'https://llm-primary.example.com',
  LLM_PRIMARY_API_KEY: 'llm-primary-mock-1234',
  LLM_FALLBACK_BASE_URL: 'https://llm-fallback.example.com',
  LLM_FALLBACK_API_KEY: 'llm-fallback-mock-1234',
  ADMIN_PASSWORD: 'admin-test-pwd',
  USE_MOCK_LLM: true,
  USE_MOCK_LICENSE: true,
  ALLOWED_ADMIN_IPS: '127.0.0.1/32,10.0.0.0/8',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: 6379,
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
};

const makeEnv = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ ...validEnv, ...overrides });

describe('AppConfigSchema', () => {
  it('3.2.a 必填字段缺失：safeParse 返回 success=false 且 issues 数 > 0', () => {
    const { WECHAT_CORP_ID, ...rest } = validEnv;
    const result = AppConfigSchema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
      // 至少有一处是 WECHAT_CORP_ID 缺失
      const paths = result.error.issues.map((i: any) => i.path.join('.'));
      expect(paths).toContain('WECHAT_CORP_ID');
    }
  });

  it('3.2.b 字段类型错误：WECHAT_AGENT_ID 是字符串而非数字 → success=false', () => {
    const bad = makeEnv({ WECHAT_AGENT_ID: 'not-a-number' });
    const result = AppConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i: any) => i.path.join('.'));
      expect(paths).toContain('WECHAT_AGENT_ID');
    }
  });

  it('3.2.c WECHAT_ENCODING_AES_KEY 长度错误（非 43 字符）→ success=false', () => {
    const bad = makeEnv({ WECHAT_ENCODING_AES_KEY: 'too-short' });
    const result = AppConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i: any) => i.path.join('.'));
      expect(paths).toContain('WECHAT_ENCODING_AES_KEY');
    }
  });

  it('3.2.d FASTGPT_BASE_URL 不是合法 URL → success=false', () => {
    const bad = makeEnv({ FASTGPT_BASE_URL: 'not-a-url' });
    const result = AppConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i: any) => i.path.join('.'));
      expect(paths).toContain('FASTGPT_BASE_URL');
    }
  });

  it('3.2.e 多个字段同时错误：safeParse 在首处失败即停止，仍返回 issues', () => {
    const bad = makeEnv({ WECHAT_CORP_ID: '', WECHAT_TOKEN: 'x' });
    const result = AppConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('3.2.f 正常实例化：safeParse 返回 success=true，输出包含全部字段', () => {
    const result = AppConfigSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.WECHAT_CORP_ID).toBe('ww1234567890abcdef');
      expect(result.data.WECHAT_AGENT_ID).toBe(1000001);
      expect(result.data.CONFIDENCE_THRESHOLD).toBeCloseTo(0.75, 2);
      expect(result.data.USE_MOCK_LLM).toBe(true);
      expect(result.data.ALLOWED_ADMIN_IPS).toBe('127.0.0.1/32,10.0.0.0/8');
    }
  });

  it('3.2.g 默认值生效：ADMIN_USER 不传 → 默认 "admin"', () => {
    const { ADMIN_USER: _omit, ...rest } = validEnv;
    const result = AppConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ADMIN_USER).toBe('admin');
    }
  });

  it('3.2.h 可选字段不传：WECHAT_BOT_USER_ID 不传 → 默认空字符串', () => {
    const { WECHAT_BOT_USER_ID: _omit, ...rest } = validEnv;
    const result = AppConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.WECHAT_BOT_USER_ID).toBe('');
    }
  });
});