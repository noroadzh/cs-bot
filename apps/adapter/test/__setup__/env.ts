/**
 * 全局测试环境设置（jest setupFiles，在测试框架注入前执行）
 *
 * 1) 注入必备环境变量（zod schema 必填项）
 * 2) 拦截 ioredis 模块解析，强制走 ioredis-mock（避免真实连接）
 * 3) ConfigService 单例注入（模块顶层同步执行）
 *
 * 注意：setupFiles 阶段 jest 未注入 beforeAll 等 API，
 * 所以这里只用模块顶层同步执行，保证在测试文件 import 之前生效。
 */
import Module from 'module';
import { tmpdir } from 'os';
import { join } from 'path';

import { ConfigService } from '../../src/config/config.service.js';
import { AppConfigSchema } from '../../src/config/config.schema.js';
import type { AppConfigInput } from '../../src/config/config.schema.js';

// ---------------------------------------------------------------------------
// 1. ioredis → ioredis-mock 模块解析拦截
// ---------------------------------------------------------------------------
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'ioredis') return originalResolve.call(this, 'ioredis-mock', ...rest);
  return originalResolve.call(this, request, ...rest);
};

// ---------------------------------------------------------------------------
// 2. 环境变量注入（模块顶层同步执行）
// ---------------------------------------------------------------------------
const ENV_OVERRIDES: Record<string, string> = {
  WECHAT_CORP_ID: 'ww1234567890abcdef',
  WECHAT_AGENT_ID: '1000002',
  WECHAT_AGENT_SECRET: 'mock-agent-secret-12345',
  WECHAT_TOKEN: 'TokenTest',
  WECHAT_ENCODING_AES_KEY: 'A'.repeat(43),
  FASTGPT_BASE_URL: 'https://fastgpt.example.com',
  FASTGPT_API_KEY: 'fastgpt-mock-key-1234',
  LLM_PRIMARY_BASE_URL: 'https://llm-primary.example.com',
  LLM_PRIMARY_API_KEY: 'llm-primary-mock-1234',
  LLM_FALLBACK_BASE_URL: 'https://llm-fallback.example.com',
  LLM_FALLBACK_API_KEY: 'llm-fallback-mock-1234',
  ADMIN_PASSWORD: 'admin-test-pwd',
  MOCK_QA_FILE: join(tmpdir(), 'csbot-mock-qa.json'),
  KEYWORDS_FILE: join(tmpdir(), 'csbot-keywords.yml'),
  WECHAT_BOT_USER_ID: 'bot-user-001',
  ALLOWED_ADMIN_IPS: '127.0.0.1/32,10.0.0.0/8',
  USE_MOCK_LLM: 'true',
  USE_MOCK_LICENSE: 'true',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
};

for (const [k, v] of Object.entries(ENV_OVERRIDES)) {
  if (process.env[k] === undefined) process.env[k] = v;
}

// ---------------------------------------------------------------------------
// 3. ConfigService 单例注入（模块顶层同步执行）
// ---------------------------------------------------------------------------
try {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v;
  }
  const parsed = AppConfigSchema.parse(merged) as AppConfigInput;
  (ConfigService as any)._instance = parsed;
} catch (err) {
  console.error('[env.ts] AppConfigSchema 校验失败:', (err as Error).message);
  console.error('[env.ts] 提示: 检查缺失的必填环境变量。');
}
