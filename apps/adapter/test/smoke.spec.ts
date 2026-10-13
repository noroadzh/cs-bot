/**
 * 端到端冒烟测试
 *
 * 策略：在 jest.doMock 层全局替换 ioredis/pg/axios，
 * 用 NestJS Test.createTestingModule 启动 AppModule，
 * 通过 supertest 对 in-process HTTP server 发起请求。
 *
 * 覆盖：
 * - GET /healthz  → 200（Redis/PG/License 全部 mock）
 * - GET /admin/license  无认证 → 401
 * - GET /admin/license  带正确 Basic Auth → 200 + valid=true
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConfigService } from '../src/config/config.service.js';
import { AppConfigSchema } from '../src/config/config.schema.js';
import type { AppConfigInput } from '../src/config/config.schema.js';
import { setConfig } from './__setup__/test-helpers.js';
import request from 'supertest';

// ---------------------------------------------------------------------------
// 全局 mock（ioredis / pg / axios）
// ---------------------------------------------------------------------------
jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    ping: jest.fn().mockResolvedValue('PONG'),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    script: jest.fn().mockResolvedValue('sha1'),
    disconnect: jest.fn(),
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    end: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('axios', () => ({
  create: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue({ data: { errcode: 0, access_token: 'mock-token' } }),
    post: jest.fn().mockResolvedValue({ data: { errcode: 0 } }),
  }),
}));

// ---------------------------------------------------------------------------
// 构造有效配置并注入到 ConfigService 单例
// ---------------------------------------------------------------------------
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
  MOCK_QA_FILE: '',
  KEYWORDS_FILE: '',
  WECHAT_BOT_USER_ID: '',
  ALLOWED_ADMIN_IPS: '127.0.0.1/32,10.0.0.0/8',
  USE_MOCK_LLM: true,
  USE_MOCK_LICENSE: true,
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: 6379,
  DATABASE_URL: 'postgresql://cs:cs@127.0.0.1:5432/csbot',
};

let app: any;

const adminAuth = (user = 'admin', pass = 'admin-test-pwd'): string =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

beforeAll(async () => {
  const parsed = AppConfigSchema.parse(validEnv) as AppConfigInput;
  (ConfigService as any)._instance = parsed;

  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = module.createNestApplication();
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
  (ConfigService as any)._instance = undefined;
});

describe('smoke.spec.ts', () => {
  it('4.1.a GET /healthz → 200 status=ok（无任何依赖异常）', async () => {
    const res = await request(app.getHttpServer()).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body.license).toHaveProperty('valid');
  });

  it('4.1.b GET /admin/license 无认证 → 401', async () => {
    const res = await request(app.getHttpServer()).get('/admin/license');
    expect(res.status).toBe(401);
  });

  it('4.1.c GET /admin/license 错误密码 → 401', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/license')
      .set('Authorization', adminAuth('admin', 'wrong-password'));
    expect(res.status).toBe(401);
  });

  it('4.1.d GET /admin/license 正确认证 → 200 + license.valid=true', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/license')
      .set('Authorization', adminAuth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('valid', true);
  });
});