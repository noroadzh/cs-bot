/**
 * ImportController 端到端 supertest spec
 *
 * 覆盖 10 个端点，依赖 AdminGuard + ImportJobService → PG pool。
 * pg 模块全局 mock；通过 request 内的 Basic Auth 通过 AdminGuard。
 *
 * 端点清单（spec import-job/spec.md §2）：
 *   POST   /admin/import-jobs        创建任务（单文件上传，字段 file，可选 name）
 *   POST   /admin/import-jobs/from-url 远程抓取建任务
 *   GET    /admin/import-jobs        列表 + 分页 + 状态过滤
 *   GET    /admin/import-jobs/counts 各状态 job 计数
 *   GET    /admin/import-jobs/:id    job 详情
 *   DELETE /admin/import-jobs/:id    删除 job + 级联 items
 *   POST   /admin/import-jobs/:id/parse  触发解析
 *   GET    /admin/import-jobs/:id/items  条目分页
 *   PATCH  /admin/import-jobs/:id/items/:itemId  逐条审核
 *   POST   /admin/import-jobs/:id/approve-all    批量通过
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { ConfigService } from '../src/config/config.service.js';
import { AppConfigSchema, AppConfigInput } from '../src/config/config.schema.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';
import request from 'supertest';

// ---------------------------------------------------------------------------
// 全局 mock：ioredis / pg / axios
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

/** PgPool mock，需要动态修改 query 返回值 */
const _rows = {
  import_jobs: [
    {
      id: 'job-1',
      name: 'test-import',
      source_filename: 'test.csv',
      source_hash: 'hash-1',
      status: 'uploaded',
      item_count: 0,
      parse_error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
  import_items: [],
  approved_qa: [],
};
const _singleRow = {
  'job-1': {
    id: 'job-1',
    name: 'test-import',
    source_filename: 'test.csv',
    source_hash: 'hash-1',
    status: 'uploaded',
    item_count: 0,
    parse_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
};

const pgQueryMock = jest.fn((sql, params) => {
  // import_item SELECT
  // FOR UPDATE (e.g. reviewItem SELECT ... FOR UPDATE)
  if (sql.includes('FOR UPDATE')) {
    const p = params || [];
    const itemId = p[0];
    const jobId = p[1];
    const row = _rows.import_items.find(
      (i) => i.id === itemId && i.job_id === jobId,
    );
    return Promise.resolve({ rows: row ? [row] : [], rowCount: row ? 1 : 0 });
  }
  if (sql.includes('import_item') && !sql.includes('UPDATE') && !sql.includes('DELETE') && !sql.includes('COUNT')) {
    return Promise.resolve({ rows: _rows.import_items, rowCount: _rows.import_items.length });
  }
  // import_item FILTER COUNT — used by approveAll pre-count
  if (sql.includes('import_item') && sql.includes('FILTER')) {
    const jobId = ((params || [])[0]);
    const items = _rows.import_items.filter((i) => i.job_id === jobId);
    const approvable = items.filter((i) => i.review_status === 'pending' && !(i.sensitive_flags?.length)).length;
    const skippedSensitive = items.filter((i) => i.review_status === 'pending' && (i.sensitive_flags?.length)).length;
    const skippedNotPending = items.filter((i) => i.review_status !== 'pending').length;
    return Promise.resolve({
      rows: [{ approvable, skipped_sensitive: skippedSensitive, skipped_not_pending: skippedNotPending }],
      rowCount: 1,
    });
  }
  // import_item GROUP BY review_status (used by countItemsByStatusInTx)
  if (sql.includes('import_item') && sql.includes('COUNT') && sql.includes('GROUP BY')) {
    const jobId = ((params || [])[0]);
    const counts = {};
    for (const item of _rows.import_items) {
      if ((item).job_id === jobId) {
        const st = (item).review_status || 'pending';
        counts[st] = (counts[st] || 0) + 1;
      }
    }
    return Promise.resolve({
      rows: Object.entries(counts).map(([review_status, n]) => ({ review_status, n })),
      rowCount: Object.keys(counts).length,
    });
  }
  // import_item COUNT
  if (sql.includes('import_item') && sql.includes('COUNT')) {
    return Promise.resolve({ rows: [{ n: String(_rows.import_items.length) }], rowCount: 1 });
  }
  // import_job COUNT — used by listJobs
  if (sql.includes('import_job') && sql.includes('COUNT') && !sql.includes('GROUP BY')) {
    if (sql.includes('WHERE')) {
      const status = ((params || [])[0]);
      const count = _rows.import_jobs.filter((j) => j.status === status).length;
      return Promise.resolve({ rows: [{ n: String(count) }], rowCount: 1 });
    }
    return Promise.resolve({ rows: [{ n: String(_rows.import_jobs.length) }], rowCount: 1 });
  }
  // import_job GROUP BY — used by countJobsByStatusInTx
  if (sql.includes('import_job') && sql.includes('COUNT') && sql.includes('GROUP BY')) {
    const counts = {};
    for (const job of _rows.import_jobs) {
      const st = (job).status || 'uploaded';
      counts[st] = (counts[st] || 0) + 1;
    }
    return Promise.resolve({
      rows: Object.entries(counts).map(([status, n]) => ({ status, n })),
      rowCount: Object.keys(counts).length,
    });
  }
  // import_job WHERE id — single row lookup
  if (sql.includes('import_job') && sql.includes('WHERE id')) {
    const id = ((params || [])[0]);
    const key = Array.isArray(id) ? id[0] : id;
    const row = _singleRow[key];
    if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
    return Promise.resolve({ rows: [row], rowCount: 1 });
  }
  // import_job WHERE source_hash — findReusableJob（按 hash 过滤，防误复用任意已有 job）
  if (sql.includes('import_job') && sql.includes('source_hash = $1')) {
    const hash = ((params || [])[0]);
    const rows = _rows.import_jobs.filter((j) => j.source_hash === hash);
    return Promise.resolve({ rows, rowCount: rows.length });
  }
  // import_job SELECT — list
  if (sql.includes('import_job') && !sql.includes('INSERT') && !sql.includes('UPDATE') && !sql.includes('DELETE')) {
    return Promise.resolve({ rows: _rows.import_jobs, rowCount: _rows.import_jobs.length });
  }
  // approved_qa INSERT (ON CONFLICT DO UPDATE) — upsert
  if (sql.includes('approved_qa') && sql.includes('INSERT')) {
    const paramOffset = params ? (params || []).length / 5 : 1;
    for (let i = 0; i < (params || []).length / 5; i++) {
      const offset = i * 5;
      const question = (params || [])[offset + 1];
      const answer = (params || [])[offset + 2];
      const sourceJobId = (params || [])[offset + 3];
      const sourceItemId = (params || [])[offset + 4];
      const idx = _rows.approved_qa.findIndex((a) => a.question === question);
      const row = {
        id: (params || [])[offset],
        question,
        answer,
        source_job_id: sourceJobId,
        source_item_id: sourceItemId,
        created_at: new Date().toISOString(),
      };
      if (idx >= 0) {
        _rows.approved_qa[idx] = { ..._rows.approved_qa[idx], ...row };
      } else {
        _rows.approved_qa.push(row);
      }
    }
    return Promise.resolve({ rows: [], rowCount: (params || []).length / 5 });
  }
  // approved_qa SELECT
  if (sql.includes('approved_qa')) {
    return Promise.resolve({ rows: _rows.approved_qa, rowCount: _rows.approved_qa.length });
  }
  // UPDATE on import_item — mutate _rows and return updated rows
  if (sql.includes('UPDATE') && sql.includes('import_item')) {
    // 批量 approve-all UPDATE（RETURNING 结尾，WHERE job_id = $1 AND review_status...）
    if (sql.includes('RETURNING') && sql.includes('WHERE job_id = $1') && !sql.includes('WHERE id = $1')) {
      const jobId = ((params || [])[0]);
      const now = (params || [])[1] || new Date().toISOString();
      const updated = [];
      for (const item of _rows.import_items) {
        if (
          item.job_id === jobId &&
          (item.review_status === 'pending' || item.review_status === 'needs-fix') &&
          !(item.sensitive_flags && item.sensitive_flags.length)
        ) {
          item.review_status = 'approved';
          item.reviewed_at = now;
          item.reviewer_note = null;
          updated.push(item);
        }
      }
      return Promise.resolve({ rows: updated, rowCount: updated.length });
    }
    if (sql.includes('review_status')) {
      const itemId = ((params || [])[0]);
      const jobId = ((params || [])[1]);
      const newStatus = ((params || [])[2]);
      const note = ((params || [])[3]);
      const reviewedAt = ((params || [])[4]);
      const now = reviewedAt || new Date().toISOString();
      const updated = [];
      for (const item of _rows.import_items) {
        if (item.id === itemId && item.job_id === jobId) {
          item.review_status = newStatus;
          item.reviewed_at = now;
          item.reviewer_note = note || null;
          updated.push(item);
        }
      }
      return Promise.resolve({ rows: updated, rowCount: updated.length });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  // UPDATE on import_job — mutate _rows and return updated row
  if (sql.includes('UPDATE') && sql.includes('import_job') && !sql.includes('import_item')) {
    const newStatus = ((params || [])[1]);
    const jobId = ((params || [])[0]);
    for (const job of _rows.import_jobs) {
      if (job.id === jobId) {
        job.status = newStatus;
        job.updated_at = new Date().toISOString();
        break;
      }
    }
    const single = _singleRow[jobId];
    if (single) {
      single.status = newStatus;
      single.updated_at = new Date().toISOString();
      return Promise.resolve({ rows: [single], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  }
  // INSERT
  if (sql.includes('INSERT')) {
    if (sql.includes('import_job')) {
      const now = new Date().toISOString();
      const paramsArr = params || [];
      const newJob = {
        id: paramsArr[0] || 'new-job',
        name: paramsArr[1] || 'test',
        source_filename: paramsArr[2] || 'test.csv',
        source_hash: paramsArr[3] || 'abc',
        status: 'uploaded',
        item_count: 0,
        parse_error: null,
        stored_path: paramsArr[5] || 'data/import/new-job',
        mime_type: paramsArr[6] || 'text/csv',
        created_at: paramsArr[4] || now,
        updated_at: paramsArr[4] || now,
      };
      _rows.import_jobs.push(newJob);
      _singleRow[newJob.id] = { ...newJob };
      return Promise.resolve({ rows: [newJob], rowCount: 1 });
    }
    if (sql.includes('import_item')) {
      const newItem = {
        id: 'new-item',
        job_id: params?.[1] || 'job-1',
        review_status: 'pending',
      };
      _rows.import_items.push(newItem);
      return Promise.resolve({ rows: [newItem], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  // DELETE
  if (sql.includes('DELETE')) {
    if (sql.includes('approved_qa')) {
      const itemId = ((params || [])[0]);
      _rows.approved_qa = _rows.approved_qa.filter((a) => a.source_item_id !== itemId);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sql.includes('import_job')) {
      const jobId = ((params || [])[0]);
      _rows.import_jobs = _rows.import_jobs.filter(j => j.id !== jobId);
      delete _singleRow[jobId];
    }
    if (sql.includes('import_item')) {
      const itemId = ((params || [])[0]);
      _rows.import_items = _rows.import_items.filter(i => i.id !== itemId);
    }
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  return Promise.resolve({ rows: [], rowCount: 0 });
});

jest.mock('pg', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    end: jest.fn().mockResolvedValue(undefined),
  })),
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({ query: pgQueryMock, release: jest.fn() }),
    query: pgQueryMock,
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
// Mock license
// ---------------------------------------------------------------------------
const MOCK_LICENSE_PATH = '/tmp/test-license-import.lic';
const mockLicensePayload = {
  expiresAtMs: Date.now() + 86_400_000 * 365,
  fingerprint: '',
  maxChats: 100,
};
const mockLicense = `${Buffer.from(JSON.stringify(mockLicensePayload), 'utf8').toString('base64')}.mock-sig`;

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------
const validEnv = {
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
  LICENSE_FILE: MOCK_LICENSE_PATH,
};

let app;

const adminAuth = (user = 'admin', pass = 'admin-test-pwd') =>
  `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`;

beforeAll(async () => {
  const fs = await import('node:fs');
  fs.writeFileSync(MOCK_LICENSE_PATH, mockLicense, 'utf8');
  process.env.LICENSE_FILE = MOCK_LICENSE_PATH;

  const parsed = AppConfigSchema.parse(validEnv);
  (ConfigService as any)._instance = parsed;

  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = module.createNestApplication();
  await app.init();
});

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  resetConfig();
  setConfig({ USE_MOCK_LLM: true, USE_MOCK_LICENSE: true });
  _rows.import_jobs = [
    {
      id: 'job-1',
      name: 'test-import',
      source_filename: 'test.csv',
      source_hash: 'hash-1',
      status: 'uploaded',
      item_count: 0,
      parse_error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];
  _rows.import_items = [];
  _rows.approved_qa = [];
  _singleRow['job-1'] = {
    id: 'job-1',
    name: 'test-import',
    source_filename: 'test.csv',
    source_hash: 'hash-1',
    status: 'uploaded',
    item_count: 0,
    parse_error: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
  pgQueryMock.mockClear?.();
});

afterEach(() => {
  resetConfig();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const baseURL = '/admin/import-jobs';
const auth = adminAuth();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('ImportController (supertest)', () => {
  // ---- POST /admin/import-jobs ----
  describe('POST /admin/import-jobs', () => {
    it('无 file → 400 BadRequest', async () => {
      const res = await request(app.getHttpServer())
        .post(baseURL)
        .set('Authorization', auth)
        .send({ name: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.errCode).toBe('IMPORT_NO_FILE');
    });

    it('有文件 → 返回 job，状态 uploaded', async () => {
      const buf = Buffer.from('q,a\n你好,世界', 'utf8');
      const res = await request(app.getHttpServer())
        .post(baseURL)
        .set('Authorization', auth)
        .field('name', 'my-import')
        .attach('file', buf, { filename: 'qa.csv', contentType: 'text/csv' });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.status).toBe('uploaded');
      expect(res.body.sourceFilename).toBe('qa.csv');
      // 内部字段不得出现在 API 响应（storedPath 泄露 = 任意文件读取面）
      expect(res.body.storedPath).toBeUndefined();
      expect(res.body.mimeType).toBeUndefined();
    });

    it('文件超过 IMPORT_MAX_FILE_BYTES → 413 IMPORT_FILE_TOO_LARGE，不落盘不建 job', async () => {
      setConfig({ IMPORT_MAX_FILE_BYTES: 8 });
      const buf = Buffer.from('q,a\n你好,世界', 'utf8'); // 10 bytes
      const res = await request(app.getHttpServer())
        .post(baseURL)
        .set('Authorization', auth)
        .field('name', 'too-big')
        .attach('file', buf, { filename: 'qa.csv', contentType: 'text/csv' });
      expect(res.status).toBe(413);
      expect(res.body.errCode).toBe('IMPORT_FILE_TOO_LARGE');
    });
  });

  // ---- POST /admin/import-jobs/from-url ----
  describe('POST /admin/import-jobs/from-url', () => {
    it('无 url → 400 BadRequest', async () => {
      const res = await request(app.getHttpServer())
        .post(`${baseURL}/from-url`)
        .set('Authorization', auth)
        .send({ name: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.errCode).toBe('IMPORT_URL_MISSING');
    });

    it('有 url → 返回 job', async () => {
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/csv' },
        arrayBuffer: () => Buffer.from('Q1,A1').buffer,
      });

      try {
        const res = await request(app.getHttpServer())
          .post(`${baseURL}/from-url`)
          .set('Authorization', auth)
          .send({ url: 'https://example.com/qa.csv', name: 'url-import' });
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.status).toBe('uploaded');
      } finally {
        global.fetch = origFetch;
      }
    });

    it('URL 返回不支持的 MIME → 415，不建 job', async () => {
      const origFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'application/xml' },
        arrayBuffer: () => Buffer.from('<xml/>').buffer,
      });

      try {
        const res = await request(app.getHttpServer())
          .post(`${baseURL}/from-url`)
          .set('Authorization', auth)
          .send({ url: 'https://example.com/data.xml', name: 'xml-import' });
        expect(res.status).toBe(415);
        expect(res.body.errCode).toBe('UNSUPPORTED_MEDIA_TYPE');
      } finally {
        global.fetch = origFetch;
      }
    });
  });

  // ---- GET /admin/import-jobs ----
  describe('GET /admin/import-jobs', () => {
    it('无过滤 → 返回列表 + total', async () => {
      const res = await request(app.getHttpServer())
        .get(baseURL)
        .set('Authorization', auth)
        .query({ limit: 10, offset: 0 });
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(res.body.total).toBe(1);
      expect(res.body.items[0].id).toBe('job-1');
    });

    it('带 status 过滤', async () => {
      const res = await request(app.getHttpServer())
        .get(baseURL)
        .set('Authorization', auth)
        .query({ limit: 10, offset: 0, status: 'uploaded' });
      expect(res.status).toBe(200);
      expect(res.body.items[0].status).toBe('uploaded');
    });

    it('缺 limit/offset → 默认值', async () => {
      const res = await request(app.getHttpServer())
        .get(baseURL)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
    });
  });

  // ---- GET /admin/import-jobs/counts ----
  describe('GET /admin/import-jobs/counts', () => {
    it('返回各状态计数', async () => {
      const res = await request(app.getHttpServer())
        .get(`${baseURL}/counts`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.uploaded).toBeDefined();
    });
  });

  // ---- GET /admin/import-jobs/:id ----
  describe('GET /admin/import-jobs/:id', () => {
    it('存在 job → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${baseURL}/job-1`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.job).toBeDefined();
      expect(res.body.job.id).toBe('job-1');
      expect(res.body.job.name).toBe('test-import');
      expect(res.body.itemCounts).toBeDefined();
      expect(res.body.deletable).toBe(true);
    });

    it('不存在 → 404 JOB_NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .get(`${baseURL}/nonexistent`)
        .set('Authorization', auth);
      expect(res.status).toBe(404);
      expect(res.body.errCode).toBe('IMPORT_JOB_NOT_FOUND');
    });
  });

  // ---- DELETE /admin/import-jobs/:id ----
  describe('DELETE /admin/import-jobs/:id', () => {
    it('可删除 → 204', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${baseURL}/job-1`)
        .set('Authorization', auth);
      expect(res.status).toBe(204);
    });
  });

  // ---- POST /admin/import-jobs/:id/parse ----
  describe('POST /admin/import-jobs/:id/parse', () => {
    it('触发解析 → 返回 updated job', async () => {
      const res = await request(app.getHttpServer())
        .post(`${baseURL}/job-1/parse`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('job-1');
      expect(['uploaded', 'parsing', 'parsed']).toContain(res.body.status);
    });
  });

  // ---- GET /admin/import-jobs/:id/items ----
  describe('GET /admin/import-jobs/:id/items', () => {
    it('返回条目列表', async () => {
      const res = await request(app.getHttpServer())
        .get(`${baseURL}/job-1/items`)
        .set('Authorization', auth)
        .query({ limit: 20, offset: 0 });
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });

  // ---- PATCH /admin/import-jobs/:id/items/:itemId ----
  describe('PATCH /admin/import-jobs/:id/items/:itemId', () => {
    it('approved → 返回更新后的 item', async () => {
      _rows.import_items = [
        {
          id: 'item-1',
          job_id: 'job-1',
          question: '怎么退款？',
          answer_raw: '联系客服',
          answer_redacted: '联系客服',
          sensitive_flags: [],
          review_status: 'pending',
          reviewed_at: null,
          reviewer_note: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];
      _rows.approved_qa = [];

      const res = await request(app.getHttpServer())
        .patch(`${baseURL}/job-1/items/item-1`)
        .set('Authorization', auth)
        .send({ reviewStatus: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('approved');
    });

    it('rejected → 返回 rejected', async () => {
      _rows.import_items = [
        {
          id: 'item-2',
          job_id: 'job-1',
          question: '敏感问题',
          answer_raw: '敏感回答',
          answer_redacted: 'XXX',
          sensitive_flags: ['pii'],
          review_status: 'pending',
          reviewed_at: null,
          reviewer_note: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const res = await request(app.getHttpServer())
        .patch(`${baseURL}/job-1/items/item-2`)
        .set('Authorization', auth)
        .send({ reviewStatus: 'rejected' });
      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('rejected');
    });

    it('needs-fix → 返回 needs-fix', async () => {
      _rows.import_items = [
        {
          id: 'item-3',
          job_id: 'job-1',
          question: '质量差',
          answer_raw: '乱写',
          answer_redacted: '乱写',
          sensitive_flags: [],
          review_status: 'pending',
          reviewed_at: null,
          reviewer_note: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const res = await request(app.getHttpServer())
        .patch(`${baseURL}/job-1/items/item-3`)
        .set('Authorization', auth)
        .send({ reviewStatus: 'needs-fix' });
      expect(res.status).toBe(200);
      expect(res.body.reviewStatus).toBe('needs-fix');
    });
  });

  // ---- POST /admin/import-jobs/:id/approve-all ----
  describe('POST /admin/import-jobs/:id/approve-all', () => {
    beforeEach(() => {
      // approveAll requires job status === 'parsed'
      _singleRow['job-1'].status = 'parsed';
      _rows.import_jobs[0].status = 'parsed';
    });

    it('无条目 → approved=0', async () => {
      const res = await request(app.getHttpServer())
        .post(`${baseURL}/job-1/approve-all`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(0);
      expect(res.body.skippedSensitive).toBe(0);
      expect(res.body.skippedNotPending).toBe(0);
    });

    it('有 pending 条目 → approved 计数', async () => {
      _rows.import_items = [
        {
          id: 'ia-1',
          job_id: 'job-1',
          question: 'Q1',
          answer_raw: 'A1',
          answer_redacted: 'A1',
          sensitive_flags: [],
          review_status: 'pending',
          reviewed_at: null,
          reviewer_note: null,
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'ia-2',
          job_id: 'job-1',
          question: 'Q2',
          answer_raw: 'A2',
          answer_redacted: 'A2',
          sensitive_flags: ['pii'],
          review_status: 'pending',
          reviewed_at: null,
          reviewer_note: null,
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const res = await request(app.getHttpServer())
        .post(`${baseURL}/job-1/approve-all`)
        .set('Authorization', auth);
      expect(res.status).toBe(200);
      expect(res.body.approved).toBe(1);
      expect(res.body.skippedSensitive).toBe(1);
      expect(res.body.skippedNotPending).toBe(0);
    });
  });

  // ---- AdminGuard enforcement ----
  describe('AdminGuard enforcement', () => {
    it('无 Auth header → 401', async () => {
      const res = await request(app.getHttpServer()).get(baseURL);
      expect(res.status).toBe(401);
    });

    it('错误密码 → 401', async () => {
      const res = await request(app.getHttpServer())
        .get(baseURL)
        .set('Authorization', adminAuth('admin', 'wrong-password'));
      expect(res.status).toBe(401);
    });
  });
});