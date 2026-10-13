/**
 * ConfigController 单元测试
 *
 * 对应 src/admin/config.controller.ts 的分支：
 * - GET /admin/config-check：secret 字段有值 → present=true 且 masked 为中段掩码
 * - GET /admin/config-check：secret 字段为空串 → present=false 且 masked 为 undefined
 * - GET /admin/config-check：非 secret 字段 → 只有 present，无 masked
 * - GET /admin/config-check：mode 字段由 ConfigService 单例决定
 * - POST /admin/config/reload → 调用 trigger.reload() 返回 {reloaded, keywords}
 * - POST /admin/keywords/reload → 调用 trigger.reload() 返回 {reloaded, count}
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

/** ConfigController.check() 直接读 process.env，不走 ConfigService */
const SECRET_ENV = {
  WECHAT_AGENT_SECRET: 'topsecretvalue',
  WECHAT_TOKEN: 'token-value-xyz',
  WECHAT_ENCODING_AES_KEY: 'A'.repeat(43),
  FASTGPT_API_KEY: 'fastgpt-mock-key-1234',
  LLM_PRIMARY_API_KEY: 'llm-primary-mock-1234',
  LLM_FALLBACK_API_KEY: 'llm-fallback-mock-1234',
  ADMIN_PASSWORD: 'admin-test-pwd',
  REDIS_PASSWORD: '',
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
};

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  resetConfig();
  // controller 字段初始化即读 ConfigService.instance，必须先注入
  setConfig({ USE_MOCK_LLM: true, USE_MOCK_LICENSE: true });
  for (const [k, v] of Object.entries(SECRET_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetConfig();
});

function makeController(reloadReturn: number) {
  const reload = jest.fn(() => reloadReturn);
  const trigger = { reload } as any;
  const { ConfigController } = require('../src/admin/config.controller.js');
  return { controller: new ConfigController(trigger), reload };
}

describe('ConfigController', () => {
  describe('GET /admin/config-check', () => {
    it('secret 字段有值 → present=true 且 masked 为中段掩码', () => {
      const { controller } = makeController(0);

      const result = controller.check();

      expect(result.config.WECHAT_AGENT_SECRET.present).toBe(true);
      // maskPII 采用中段掩码：首 2 + *** + 末 2
      expect(result.config.WECHAT_AGENT_SECRET.masked).toBe('to***ue');
      expect(result.config.ADMIN_PASSWORD.masked).toBe('ad***wd');
      // 43 位 AES key 同样掩码
      expect(result.config.WECHAT_ENCODING_AES_KEY.masked).toContain('***');
    });

    it('secret 字段为空串 → present=false 且 masked 为 undefined', () => {
      const { controller } = makeController(0);

      const result = controller.check();

      expect(result.config.REDIS_PASSWORD.present).toBe(false);
      expect(result.config.REDIS_PASSWORD.masked).toBeUndefined();
    });

    it('非 secret 字段 → 只有 present，不返回 masked', () => {
      const { controller } = makeController(0);

      const result = controller.check();

      expect(result.config.WECHAT_CORP_ID.present).toBe(true);
      expect(result.config.WECHAT_CORP_ID.masked).toBeUndefined();
      expect(result.config.WECHAT_AGENT_ID.masked).toBeUndefined();
    });

    it('mode 字段由 ConfigService 单例决定', () => {
      setConfig({ USE_MOCK_LLM: false, USE_MOCK_LICENSE: true });
      const { controller } = makeController(0);

      const result = controller.check();

      expect(result.mode).toEqual({ useMockLlm: false, useMockLicense: true });
    });

    it('process.env 中缺失的可选字段 → present=false', () => {
      const k = 'USAGE_REPORT_ENABLED';
      const saved = process.env[k];
      delete process.env[k];
      try {
        const { controller } = makeController(0);
        expect(controller.check().config.USAGE_REPORT_ENABLED.present).toBe(false);
      } finally {
        if (saved !== undefined) process.env[k] = saved;
      }
    });
  });

  describe('POST /admin/config/reload', () => {
    it('调用 trigger.reload() 并返回 keywords 数量', () => {
      const { controller, reload } = makeController(7);

      const result = controller.reload();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ reloaded: true, keywords: 7 });
    });

    it('trigger.reload() 返回 0（空关键词表）→ keywords=0', () => {
      const { controller } = makeController(0);

      expect(controller.reload()).toEqual({ reloaded: true, keywords: 0 });
    });
  });

  describe('POST /admin/keywords/reload', () => {
    it('调用 trigger.reload() 并返回 count 数量', () => {
      const { controller, reload } = makeController(3);

      const result = controller.reloadKeywords();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ reloaded: true, count: 3 });
    });

    it('与 config/reload 是独立端点，各自调用一次 reload', () => {
      const { controller, reload } = makeController(5);

      controller.reloadKeywords();
      controller.reload();

      expect(reload).toHaveBeenCalledTimes(2);
    });
  });
});