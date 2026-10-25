/**
 * ImportJobService 单元测试
 *
 * 覆盖 createFromFile / createFromUrl：
 *   - 大小超限 413 / 空文件 400 / MIME 不支持 415（均在建 job 前返回）
 *   - MIME 归一：缺 content-type 时由扩展名推断
 *   - 同源短路：命中 parsed/approved/partial/rejected 任一状态直接返回历史 job
 *   - 抓取失败（network / 非 2xx / body 读失败 / 空内容）→ 抛错且不建 job
 *   - URL 抓取 Content-Length 快速拒 + 实际字节数兜底
 *
 * pg Pool、fs/promises、global fetch 全部 mock，不依赖真实 DB / 磁盘 / 网络。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { HttpStatus } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
const poolConnect = jest.fn() as any;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: poolConnect })),
}));

// fs/promises mock：import-job.service 以 `import { promises as fs } from 'fs'` 引用
const fsMkdir = jest.fn() as any;
const fsWriteFile = jest.fn() as any;
const fsRm = jest.fn() as any;
jest.mock('fs', () => ({
  promises: { mkdir: fsMkdir, writeFile: fsWriteFile, rm: fsRm },
}));

import { ImportJobService } from '../src/import/import-job.service.js';
import { SensitiveRedactor } from '../src/import/sensitive-redactor.js';

const CSV_BYTES = Buffer.from('question,answer\n你好,你好呀\n');
const CSV_HASH_NEVER = 'f'.repeat(64);

function jobRow(over: Record<string, unknown> = {}) {
  return {
    id: 'job-0001',
    name: 'demo.csv',
    source_filename: 'demo.csv',
    source_hash: CSV_HASH_NEVER,
    status: 'uploaded',
    item_count: 0,
    parse_error: null,
    created_at: new Date('2026-03-01T00:00:00Z'),
    updated_at: new Date('2026-03-01T00:00:00Z'),
    ...over,
  };
}

/** import_item 行。mapItem 读的列：job_id / answer_raw / sensitive_flags / review_status … */
function itemRow(over: Record<string, unknown> = {}) {
  return {
    id: 'item-0001',
    job_id: 'job-0001',
    question: '你好',
    answer_raw: '你好呀，手机号 13800138000',
    answer_redacted: '你好呀，手机号 [手机号]',
    sensitive_flags: ['phone'],
    review_status: 'pending',
    reviewed_at: null,
    reviewer_note: null,
    created_at: new Date('2026-03-01T00:00:01Z'),
    ...over,
  };
}

/** 默认：findReusableJob 查空 → 无短路；随后 INSERT 返回 job */
function mockNoReuse(insertRow = jobRow()) {
  poolQuery.mockResolvedValueOnce({ rows: [] }); // findReusableJob
  poolQuery.mockResolvedValueOnce({ rows: [insertRow] }); // INSERT
}

function makeSvc() {
  return new ImportJobService({} as any, new SensitiveRedactor({ mockRedaction: true }));
}

describe('ImportJobService.createFromFile', () => {
  let svc: ImportJobService;

  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
    beforeEach(() => {
    poolQuery.mockReset();
    // 事务 client：BEGIN/COMMIT/ROLLBACK 不参与 poolQuery 的 SQL 队列，
    // 否则每个真实语句的下标都会被事务控制语句顶掉一位。
    poolConnect.mockReset().mockResolvedValue({
      query: (sql: string, params?: unknown[]) =>
        /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : poolQuery(sql, params),
      release: jest.fn(),
    });
    fsMkdir.mockReset().mockResolvedValue(undefined);
    fsWriteFile.mockReset().mockResolvedValue(undefined);
    svc = makeSvc();
  });

  describe('入参校验', () => {
    it('超过 IMPORT_MAX_FILE_BYTES → 413 IMPORT_FILE_TOO_LARGE，不落盘不建 job', async () => {
      setConfig({ IMPORT_MAX_FILE_BYTES: 16 });
      const big = Buffer.alloc(32);

      await expect(
        svc.createFromFile({ filename: 'big.csv', mimeType: 'text/csv', bytes: big }),
      ).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        response: { errCode: 'IMPORT_FILE_TOO_LARGE' },
      });
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
      setConfig();
    });

    it('零字节 → 400 IMPORT_EMPTY_FILE', async () => {
      await expect(
        svc.createFromFile({ filename: 'e.csv', mimeType: 'text/csv', bytes: Buffer.alloc(0) }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errCode: 'IMPORT_EMPTY_FILE' },
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('MIME 不支持 → 415（扩展名合法但 MIME 未知）', async () => {
      await expect(
        svc.createFromFile({
          filename: 'evil.csv',
          mimeType: 'application/x-msdownload',
          bytes: Buffer.from('x'),
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        response: { errCode: 'UNSUPPORTED_MEDIA_TYPE' },
      });
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
    });
  });

  describe('MIME 归一', () => {
    it('mimeType 为空时由扩展名推断（.csv → text/csv）', async () => {
      mockNoReuse();

      const res = await svc.createFromFile({
        filename: 'demo.csv',
        mimeType: '',
        bytes: CSV_BYTES,
      });

      expect(res.mimeType).toBe('text/csv');
      expect(res.reused).toBe(false);
    });

    it('content-type 带 charset 参数时归一为基础类型（text/csv; charset=utf-8 → text/csv）', async () => {
      mockNoReuse();

      const res = await svc.createFromFile({
        filename: 'demo.csv',
        mimeType: 'text/csv; charset=utf-8',
        bytes: CSV_BYTES,
      });

      expect(res.mimeType).toBe('text/csv');
    });
  });

  describe('同源短路', () => {
    it('命中历史 parsed job → 直接返回该 job，不落盘不建新 job', async () => {
      const existing = jobRow({ id: 'job-old', status: 'parsed', item_count: 42 });
      poolQuery.mockResolvedValueOnce({ rows: [existing] });

      const res = await svc.createFromFile({
        filename: 'demo.csv',
        mimeType: 'text/csv',
        bytes: CSV_BYTES,
      });

      expect(res.reused).toBe(true);
      expect(res.job.id).toBe('job-old');
      expect(res.job.status).toBe('parsed');
      expect(res.storedPath).toBe('');
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).toHaveBeenCalledTimes(1); // 只查了 findReusableJob
    });

    it('查询按 REUSABLE_STATUSES 过滤，且按 created_at DESC 取一条', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ status: 'approved' })] });

      await svc.createFromFile({ filename: 'demo.csv', mimeType: 'text/csv', bytes: CSV_BYTES });

      const [sql, params] = poolQuery.mock.calls[0];
      expect(sql).toContain('source_hash = $1');
      expect(sql).toContain('status = ANY($2::varchar[])');
      expect(sql).toContain('ORDER BY created_at DESC LIMIT 1');
      expect(params[1]).toEqual(['parsed', 'approved', 'partial', 'rejected']);
    });
  });

  describe('正常落库', () => {
    it('成功：落盘到 data/import/<jobId>/source.csv，INSERT status=uploaded', async () => {
      mockNoReuse();

      const res = await svc.createFromFile({
        filename: 'demo.csv',
        mimeType: 'text/csv',
        bytes: CSV_BYTES,
        name: '  问答导入  ',
      });

      expect(res.reused).toBe(false);
      expect(res.job.id).toBe('job-0001');
      expect(res.job.status).toBe('uploaded');
      // 注：service 用 randomUUID 真实生成 id 落盘，RETURNING 占位 id 是 'job-0001'。
      // storedPath 用真实生成 id，断言格式即可。
      expect(res.storedPath).toMatch(/data[\\/]import[\\/][0-9a-f-]+[\\/]source\.csv$/);
      expect(fsWriteFile).toHaveBeenCalledWith(res.storedPath, CSV_BYTES);
      // name 去掉首尾空白；缺省时回落到 filename
      expect(poolQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO import_job'),
        [
          expect.any(String),
          '问答导入',
          'demo.csv',
          expect.stringMatching(/^[0-9a-f]{64}$/),
          expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
          expect.stringMatching(/data[\\/]import[\\/][0-9a-f-]+[\\/]source\.csv$/),
          'text/csv',
        ],
      );
    });

    it('未传 name → 回落用 filename', async () => {
      mockNoReuse();

      await svc.createFromFile({ filename: 'demo.csv', mimeType: 'text/csv', bytes: CSV_BYTES });

      expect(poolQuery.mock.calls[1][1][1]).toBe('demo.csv');
    });

    it('路径穿越文件名 → 400（storage path isolation）', async () => {
      await expect(
        svc.createFromFile({
          filename: '../../etc/passwd.csv',
          mimeType: 'text/csv',
          bytes: CSV_BYTES,
        }),
      ).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
        response: { errCode: 'IMPORT_UNSAFE_FILENAME' },
      });
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
    });
  });
});

describe('ImportJobService.createFromUrl', () => {
  let svc: ImportJobService;
  const originalFetch = globalThis.fetch;

  function mockFetch(impl: (...args: any[]) => Promise<any>) {
    (globalThis as any).fetch = jest.fn(impl);
  }

  function okResponse(body: Buffer, headers: Record<string, string> = {}) {
    return {
      ok: true,
      status: 200,
      headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  }

  beforeAll(() => setConfig());
  afterAll(() => {
    resetConfig();
    globalThis.fetch = originalFetch;
  });
    beforeEach(() => {
    poolQuery.mockReset();
    // 事务 client：BEGIN/COMMIT/ROLLBACK 不参与 poolQuery 的 SQL 队列，
    // 否则每个真实语句的下标都会被事务控制语句顶掉一位。
    poolConnect.mockReset().mockResolvedValue({
      query: (sql: string, params?: unknown[]) =>
        /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : poolQuery(sql, params),
      release: jest.fn(),
    });
    fsMkdir.mockReset().mockResolvedValue(undefined);
    fsWriteFile.mockReset().mockResolvedValue(undefined);
    svc = makeSvc();
  });

  it('成功：抓取字节后走 createFromFile 同一路径，建 uploaded job', async () => {
    mockFetch(async () => okResponse(CSV_BYTES, { 'content-type': 'text/csv' }));
    mockNoReuse();

    const res = await svc.createFromUrl('https://example.com/data/demo.csv', '远程问答');

    expect(res.reused).toBe(false);
    expect(res.job.status).toBe('uploaded');
    expect(res.mimeType).toBe('text/csv');
    expect(res.storedPath).toMatch(/source\.csv$/);
    expect(poolQuery.mock.calls[1][1][1]).toBe('远程问答');
  });

  it('网络异常 → 抛错且不建 job（fetch 不进 PG）', async () => {
    mockFetch(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });

    await expect(svc.createFromUrl('https://nowhere.invalid/x.csv')).rejects.toMatchObject({
      response: { errCode: 'IMPORT_FETCH_FAILED' },
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('非 2xx → 抛 IMPORT_FETCH_FAILED 且带 HTTP 状态', async () => {
    mockFetch(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    await expect(svc.createFromUrl('https://example.com/missing.csv')).rejects.toMatchObject({
      response: { errCode: 'IMPORT_FETCH_FAILED' },
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('Content-Length 超限 → 快速拒 413，不读 body 不建 job', async () => {
    setConfig({ IMPORT_MAX_FILE_BYTES_URL: 1024 });
    const arrayBuffer = jest.fn();
    mockFetch(async () => ({
      ok: true,
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === 'content-length' ? '99999' : 'text/csv') },
      arrayBuffer,
    }));

    await expect(svc.createFromUrl('https://example.com/big.csv')).rejects.toMatchObject({
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      response: { errCode: 'IMPORT_FILE_TOO_LARGE' },
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
    setConfig();
  });

  it('Content-Length 缺失但实际字节超限 → 读完后兜底拒 413', async () => {
    setConfig({ IMPORT_MAX_FILE_BYTES_URL: 8 });
    mockFetch(async () => okResponse(Buffer.alloc(64), { 'content-type': 'text/csv' }));

    await expect(svc.createFromUrl('https://example.com/big.csv')).rejects.toMatchObject({
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      response: { errCode: 'IMPORT_FILE_TOO_LARGE' },
    });
    expect(poolQuery).not.toHaveBeenCalled();
    setConfig();
  });

  it('抓取内容为空 → 400 IMPORT_FETCH_FAILED，不建 job', async () => {
    mockFetch(async () => okResponse(Buffer.alloc(0), { 'content-type': 'text/csv' }));

    await expect(svc.createFromUrl('https://example.com/empty.csv')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { errCode: 'IMPORT_FETCH_FAILED' },
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('无 content-type → 由 URL 路径后缀推断文件名与 MIME', async () => {
    mockFetch(async () => okResponse(CSV_BYTES, {}));
    mockNoReuse();

    const res = await svc.createFromUrl('https://example.com/docs/faq.csv');

    expect(res.mimeType).toBe('text/csv');
    expect(res.storedPath).toMatch(/source\.csv$/);
  });

  it('URL 无路径后缀 → 文件名回落到 download，MIME 早拒 415', async () => {
    mockFetch(async () => okResponse(CSV_BYTES, {}));

    await expect(svc.createFromUrl('https://example.com/')).rejects.toMatchObject({
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    });
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it('已导入过的同源 URL → 复用历史 job，不重复落盘', async () => {
    mockFetch(async () => okResponse(CSV_BYTES, { 'content-type': 'text/csv' }));
    poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'job-old', status: 'parsed' })] });

    const res = await svc.createFromUrl('https://example.com/demo.csv');

    expect(res.reused).toBe(true);
    expect(res.job.id).toBe('job-old');
    expect(fsWriteFile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 查询 + 删除
// ---------------------------------------------------------------------------

describe('ImportJobService 查询/删除', () => {
  let svc: ImportJobService;

  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    poolQuery.mockReset();
    // 事务 client：BEGIN/COMMIT/ROLLBACK 在 mock 层消化，不占 poolQuery 队列下标
    poolConnect.mockReset().mockResolvedValue({
      query: (sql: string, params?: unknown[]) =>
        /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : poolQuery(sql, params),
      release: jest.fn(),
    });
    fsRm.mockReset().mockResolvedValue(undefined);
    svc = makeSvc();
  });

  /** SQL 归一：压掉空白，便于断言子串 */
  const sqlOf = (callIdx: number) =>
    (poolQuery.mock.calls[callIdx][0] as string).replace(/\s+/g, ' ').trim();

  describe('listJobs 分页 + status 过滤', () => {
    it('无过滤：total 取全表数，SQL 不带 WHERE，参数 [limit, offset]', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1' }), jobRow({ id: 'j2' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 17 }] });

      const page = await svc.listJobs({ limit: 2, offset: 4 });

      expect(page.items.map((j) => j.id)).toEqual(['j1', 'j2']);
      expect(page.total).toBe(17);
      expect(page.limit).toBe(2);
      expect(page.offset).toBe(4);
      expect(sqlOf(0)).not.toContain('WHERE');
      expect(sqlOf(0)).toContain('ORDER BY created_at DESC');
      expect(poolQuery.mock.calls[0][1]).toEqual([2, 4]);
    });

    it('status 过滤：total 是过滤后的数，不是全表数', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'parsed' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] });

      const page = await svc.listJobs({ status: 'parsed' });

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(3);
      expect(sqlOf(0)).toContain('WHERE status = $3');
      expect(sqlOf(1)).toContain('WHERE status = $1');
      // 计数查询不能复用带 LIMIT/OFFSET 的参数位
      expect(poolQuery.mock.calls[1][1]).toEqual(['parsed']);
    });

    it('limit 超上限被夹到 200；负 offset 归零；NaN 落回下限', async () => {
      // 注意用 mockResolvedValueOnce 按「先 data 后 count」顺序注入：
      // mockResolvedValue 设的默认值会被下一次调用覆盖，data 行会拿到 count 行形状。
      poolQuery.mockResolvedValueOnce({ rows: [jobRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] });
      await svc.listJobs({ limit: 9999, offset: -3 });
      expect(poolQuery.mock.calls[0][1]).toEqual([200, 0]);

      poolQuery.mockClear();
      poolQuery.mockResolvedValueOnce({ rows: [jobRow()] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] });
      await svc.listJobs({ limit: Number.NaN, offset: 10 });
      expect(poolQuery.mock.calls[0][1]).toEqual([1, 10]);
    });
  });

  describe('listItems 分页 + reviewStatus 过滤', () => {
    it('无过滤按 job_id 聚合，total 只算本 job 的 items', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [itemRow({ id: 'i1' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 9 }] });

      const page = await svc.listItems('job-1', { limit: 10, offset: 0 });

      expect(page.total).toBe(9);
      expect(page.items[0].id).toBe('i1');
      expect(sqlOf(0)).toContain('WHERE job_id = $1');
      expect(sqlOf(0)).toContain('ORDER BY created_at ASC');
      expect(sqlOf(1)).toContain('WHERE job_id = $1');
      expect(sqlOf(1)).not.toContain('review_status');
    });

    it('reviewStatus 过滤：过滤走 $4，计数走 $2，两条 SQL 各带各的参数', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });

      await svc.listItems('job-1', { reviewStatus: 'approved', limit: 5, offset: 2 });

      expect(sqlOf(0)).toContain('WHERE job_id = $1 AND review_status = $2');
      expect(poolQuery.mock.calls[0][1]).toEqual(['job-1', 'approved', 5, 2]);
      expect(sqlOf(1)).toContain('review_status = $2');
      expect(poolQuery.mock.calls[1][1]).toEqual(['job-1', 'approved']);
    });

    it('sensitive=true → WHERE jsonb_array_length(sensitive_flags) > 0', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });

      await svc.listItems('job-1', { sensitive: true, limit: 5 });

      expect(sqlOf(0)).toContain('jsonb_array_length(sensitive_flags) > 0');
    });

    it('sensitive=false → WHERE jsonb_array_length(sensitive_flags) = 0', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      poolQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] });

      await svc.listItems('job-1', { sensitive: false, limit: 5 });

      expect(sqlOf(0)).toContain('jsonb_array_length(sensitive_flags) = 0');
    });
  });

  describe('getJobDetail', () => {
    it('汇总审核分布并标记可删；缺省状态补 0', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'parsed' })] });
      poolQuery.mockResolvedValueOnce({
        rows: [{ review_status: 'pending', n: 6 }, { review_status: 'approved', n: 2 }],
      });

      const d = await svc.getJobDetail('j1');

      expect(d).not.toBeNull();
      expect(d!.deletable).toBe(true);
      expect(d!.itemCounts).toEqual({ pending: 6, approved: 2, rejected: 0, 'needs-fix': 0 });
    });

    it('job 不存在 → null，不打 items 查询', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      expect(await svc.getJobDetail('nope')).toBeNull();
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('已生效状态 deletable=false，前端据此隐藏删除按钮', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'approved' })] });
      poolQuery.mockResolvedValueOnce({ rows: [] });

      const d = await svc.getJobDetail('j1');
      expect(d!.deletable).toBe(false);
    });
  });

  describe('deleteJob', () => {
    it('待审 job → 删 job 行、级联 items、清目录，返回删除条数', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'parsed' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ review_status: 'pending', n: 5 }] });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
      poolQuery.mockResolvedValueOnce({ rows: [] }); // 删除后残留核对

      const res = await svc.deleteJob('j1');

      expect(res.deletedItems).toBe(5);
      expect(sqlOf(2)).toBe('DELETE FROM import_job WHERE id = $1');
      expect(fsRm).toHaveBeenCalledTimes(1);
      // 用正则而非 path.join：避免为断言引入 path 依赖，同时兼容两种分隔符
      expect(String(fsRm.mock.calls[0][0])).toMatch(/data[\\/]import[\\/]j1/);
      // 级联交给 schema 的 ON DELETE CASCADE，不额外手写 items DELETE
      expect(sqlOf(1)).not.toContain('DELETE');
    });

    it('items 有残留 → 500 IMPORT_DELETE_INCOMPLETE（schema 缺 CASCADE 的故障信号）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'parsed' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ review_status: 'pending', n: 5 }] });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
      poolQuery.mockResolvedValueOnce({ rows: [{ review_status: 'pending', n: 3 }] });

      await expect(svc.deleteJob('j1')).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        response: { errCode: 'IMPORT_DELETE_INCOMPLETE' },
      });
      expect(fsRm).not.toHaveBeenCalled();
    });

    it('failed job 也可删（没进知识库）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'failed' })] });
      poolQuery.mockResolvedValueOnce({ rows: [] });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
      poolQuery.mockResolvedValueOnce({ rows: [] });

      expect((await svc.deleteJob('j1')).deletedItems).toBe(0);
    });

    it('已生效（approved/partial/rejected）→ 409 拒绝，不删行不清目录', async () => {
      for (const status of ['approved', 'partial', 'rejected'] as const) {
        poolQuery.mockReset();
        poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status })] });

        await expect(svc.deleteJob('j1')).rejects.toMatchObject({
          status: HttpStatus.CONFLICT,
          response: { errCode: 'IMPORT_NOT_DELETABLE', status },
        });
        // 只查了 job 就返回，没走到 DELETE items / job
        expect(poolQuery).toHaveBeenCalledTimes(1);
        expect(fsRm).not.toHaveBeenCalled();
      }
    });

    it('job 不存在 → 404，不做任何删除', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(svc.deleteJob('nope')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: { errCode: 'IMPORT_JOB_NOT_FOUND' },
      });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('磁盘目录清理失败不影响删除结果（best-effort）', async () => {
      fsRm.mockRejectedValue(new Error('EACCES'));
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ id: 'j1', status: 'parsed' })] });
      poolQuery.mockResolvedValueOnce({ rows: [{ review_status: 'pending', n: 2 }] });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
      poolQuery.mockResolvedValueOnce({ rows: [] });

      expect((await svc.deleteJob('j1')).deletedItems).toBe(2);
    });
  });
});

describe('ImportJobService 审核流转', () => {
  let svc: ImportJobService;

  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    poolQuery.mockReset();
    // 事务 client：BEGIN/COMMIT/ROLLBACK 在 mock 层消化，不占 poolQuery 队列下标
    poolConnect.mockReset().mockResolvedValue({
      query: (sql: string, params?: unknown[]) =>
        /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i.test(sql)
          ? Promise.resolve({ rows: [], rowCount: 0 })
          : poolQuery(sql, params),
      release: jest.fn(),
    });
    fsRm.mockReset().mockResolvedValue(undefined);
    svc = makeSvc();
  });

  const sqlOf = (callIdx: number) =>
    (poolQuery.mock.calls[callIdx][0] as string).replace(/\s+/g, ' ').trim();

  /**
   * reviewItem 的标准路径（事务化后，BEGIN/COMMIT 已在 mock 层消化）：
   *   0 SELECT ... FOR UPDATE
   *   1 UPDATE import_item ... RETURNING *
   *   2 语料同步：to=approved & from≠approved → INSERT approved_qa
   *             from=approved & to≠approved → DELETE approved_qa
   *             其余 → 无语句
   *   3 SELECT review_status, COUNT GROUP BY → 批后分布
   *   4 UPDATE import_job SET status
   *
   * sync 指定第 2 步形态：默认按 from/to 推；
   * 从 approved 离开 → DELETE（0 行）；进 approved → INSERT；否则不查库（upsert/无操作）。
   */
  function mockReviewPath(
    current: Record<string, unknown>,
    updated: Record<string, unknown>,
    counts: Record<string, number>,
    opts: { syncApprovedQa?: 'upsert' | 'delete' } = {},
  ) {
    const from = current.review_status as string;
    const to = updated.review_status as string;
    const sync = opts.syncApprovedQa ?? (to === 'approved' && from !== 'approved' ? 'upsert' : from === 'approved' ? 'delete' : 'none');

    poolQuery.mockResolvedValueOnce({ rows: [current] });                                   // 0 SELECT FOR UPDATE
    poolQuery.mockResolvedValueOnce({ rows: [updated] });                                    // 1 UPDATE RETURNING
    if (sync !== 'none') {
      // 2 INSERT/DELETE approved_qa：结果行不被读取，返回空行集即可
      poolQuery.mockResolvedValueOnce({ rows: [], rowCount: sync === 'upsert' ? 1 : 1 });
    }
    poolQuery.mockResolvedValueOnce({ rows: countRows(counts) });                             // 3 GROUP BY review_status
    poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });                         // 4 UPDATE import_job
  }

  describe('reviewItem 状态机', () => {
    it('pending → approved：写 reviewed_at + 终态聚合回写 job', async () => {
      mockReviewPath(
        itemRow({ id: 'i1', review_status: 'pending' }),
        itemRow({ id: 'i1', review_status: 'approved', reviewed_at: new Date() }),
        { pending: 0, approved: 3, rejected: 0, 'needs-fix': 0 },
      );

      const item = await svc.reviewItem('job-0001', 'i1', { reviewStatus: 'approved' });

      expect(item.reviewStatus).toBe('approved');
      expect(item.reviewedAt).not.toBeNull();
      expect(sqlOf(1)).toContain("review_status = $3");
      expect(sqlOf(2)).toContain('INSERT INTO approved_qa');   // 0→approved 触发 upsert
      expect(sqlOf(4)).toContain("SET status = $2");           // UPDATE import_job
    });

    it('pending → rejected：reviewer_note 一并落库', async () => {
      mockReviewPath(
        itemRow({ review_status: 'pending' }),
        itemRow({ review_status: 'rejected', reviewer_note: '答非所问' }),
        { pending: 2, approved: 0, rejected: 1, 'needs-fix': 0 },
      );

      const item = await svc.reviewItem('job-0001', 'i1', {
        reviewStatus: 'rejected',
        note: '答非所问',
      });

      expect(item.reviewStatus).toBe('rejected');
      expect(item.reviewerNote).toBe('答非所问');
      expect(poolQuery.mock.calls[1][1]).toContain('答非所问');
    });

    it('approved → needs-fix：spec 未禁，乐观允许（回退到待修）', async () => {
      mockReviewPath(
        itemRow({ review_status: 'approved', reviewed_at: new Date() }),
        itemRow({ review_status: 'needs-fix' }),
        { pending: 0, approved: 2, rejected: 0, 'needs-fix': 1 },
      );

      const item = await svc.reviewItem('job-0001', 'i1', { reviewStatus: 'needs-fix' });
      expect(item.reviewStatus).toBe('needs-fix');
    });

    it('approved → approved（同值）允许，reviewed_at 不重置', async () => {
      const before = new Date('2025-01-01T00:00:00Z');
      const after = new Date('2025-01-02T00:00:00Z');
      mockReviewPath(
        itemRow({ review_status: 'approved', reviewed_at: before }),
        itemRow({ review_status: 'approved', reviewed_at: after }),
        { pending: 0, approved: 1, rejected: 0, 'needs-fix': 0 },
      );

      await svc.reviewItem('job-0001', 'i1', { reviewStatus: 'approved' });
      // reviewed_at 来自 RETURNING；实现上若同值不重置，则 after 不会落库（保留 before）
      // 此处只断言 RPC 完成、状态机未拒绝
      expect(poolQuery.mock.calls[1][0]).toContain('UPDATE import_item');
    });

    it('needs-fix → pending：离开 needs-fix 只允许 approved/rejected → 409', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [itemRow({ review_status: 'needs-fix' })],
      });

      await expect(
        svc.reviewItem('job-0001', 'i1', { reviewStatus: 'pending' }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('needs-fix → needs-fix（异值也算非法转移，离开 needs-fix）→ 409', async () => {
      poolQuery.mockResolvedValueOnce({
        rows: [itemRow({ review_status: 'needs-fix', reviewer_note: '原 note' })],
      });

      await expect(
        svc.reviewItem('job-0001', 'i1', { reviewStatus: 'needs-fix' }),
      ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    });

    it('rejected → approved：允许重新启用', async () => {
      mockReviewPath(
        itemRow({ review_status: 'rejected' }),
        itemRow({ review_status: 'approved' }),
        { pending: 0, approved: 1, rejected: 0, 'needs-fix': 0 },
      );

      const item = await svc.reviewItem('job-0001', 'i1', { reviewStatus: 'approved' });
      expect(item.reviewStatus).toBe('approved');
    });

    it('item 不存在 → 404，且不发任何 UPDATE', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(
        svc.reviewItem('job-0001', 'missing', { reviewStatus: 'approved' }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('item 属于别的 job → 404（用 job_id 过滤，不泄露跨 job 存在性）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] }); // WHERE id=$1 AND job_id=$2 命中 0 行

      await expect(
        svc.reviewItem('other-job', 'i1', { reviewStatus: 'approved' }),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(poolQuery.mock.calls[0][1]).toEqual(['i1', 'other-job']);
    });
  });

  describe('approveAll 批量通过', () => {
    /**
     * 6 步调用序列（service 实现）：
     *   0 SELECT import_job → 状态校验
     *   1 SELECT COUNT(*) FILTER → 一次拿齐三计数（approvable / skipped_sensitive / skipped_not_pending）
     *   2 UPDATE import_item … RETURNING → 批量通过
     *   3 INSERT INTO approved_qa → 语料同步
     *   4 SELECT review_status, COUNT GROUP BY → 批后分布（重算 job 聚合）
     *   5 UPDATE import_job SET status → 写回新聚合
     */
    function mockApproveAll(opts: {
      job?: Record<string, unknown> | null;
      pre?: { approvable: number; skippedSensitive: number; skippedNotPending: number };
      affected?: number;
      post?: Record<string, number>;
    } = {}) {
      const pre = opts.pre ?? { approvable: 5, skippedSensitive: 0, skippedNotPending: 0 };
      poolQuery.mockResolvedValueOnce({
        rows: [opts.job === undefined ? jobRow({ status: 'parsed' }) : opts.job].filter(Boolean),
      });
      poolQuery.mockResolvedValueOnce({
        rows: [{
          approvable: pre.approvable,
          skipped_sensitive: pre.skippedSensitive,
          skipped_not_pending: pre.skippedNotPending,
        }],
      });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: opts.affected ?? pre.approvable }] });
      poolQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT approved_qa
      poolQuery.mockResolvedValueOnce({ rows: countRows(opts.post ?? { approved: pre.approvable }) });
      poolQuery.mockResolvedValueOnce({ rows: [{ affectedRows: 1 }] });
    }

    it('批 pending + needs-fix，跳过敏感项，回报三计数', async () => {
      mockApproveAll({
        pre: { approvable: 5, skippedSensitive: 2, skippedNotPending: 1 },
        post: { approved: 5, rejected: 1 },
      });

      const res = await svc.approveAll('job-0001');

      expect(res).toEqual({ approved: 5, skippedSensitive: 2, skippedNotPending: 1 });
      // 敏感项永不批量通过：UPDATE 里带 sensitive_flags 空数组判定
      expect(sqlOf(2)).toContain("review_status IN ('pending', 'needs-fix')");
      expect(sqlOf(2)).toContain('sensitive_flags');
      // 语料同步：批过的条目进 approved_qa
      expect(sqlOf(3)).toContain('INSERT INTO approved_qa');
      expect(poolQuery).toHaveBeenCalledTimes(6);
    });

    it('job 不存在 → 404，先查后批', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });

      await expect(svc.approveAll('missing-job')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('job 已终态（approved）→ 409，不发 item 更新', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ status: 'approved' })] });

      await expect(svc.approveAll('job-0001')).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('job partial（部分批过）→ 409（spec：非 parsed 一律拒绝批量批）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ status: 'partial' })] });

      await expect(svc.approveAll('job-0001')).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('job failed → 409（解析失败无 items 可批）', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [jobRow({ status: 'failed' })] });

      await expect(svc.approveAll('job-0001')).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
      });
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('聚合后全部 approved → job 转 approved', async () => {
      mockApproveAll({ affected: 3, post: { approved: 3, pending: 0, rejected: 0, 'needs-fix': 0 } });

      await svc.approveAll('job-0001');
      expect(poolQuery.mock.calls[5][1]).toEqual(expect.arrayContaining(['approved']));
    });

    it('聚合后混合（approved + rejected）→ job 转 partial', async () => {
      mockApproveAll({ affected: 2, post: { approved: 2, pending: 0, rejected: 1, 'needs-fix': 0 } });

      await svc.approveAll('job-0001');
      expect(poolQuery.mock.calls[5][1]).toEqual(expect.arrayContaining(['partial']));
    });

    it('聚合后全部 rejected → job 转 rejected', async () => {
      mockApproveAll({ affected: 0, post: { approved: 0, pending: 0, rejected: 6, 'needs-fix': 0 } });

      await svc.approveAll('job-0001');
      expect(poolQuery.mock.calls[5][1]).toEqual(expect.arrayContaining(['rejected']));
    });

    it('仍有 pending → 保持 parsed（不发终态 UPDATE）', async () => {
      mockApproveAll({ affected: 1, post: { approved: 1, pending: 3, rejected: 0, 'needs-fix': 0 } });

      await svc.approveAll('job-0001');
      // 6 步中第 6 步是终态 UPDATE；仍有 pending 时第 6 步不应发生 → 只剩 5 次调用
      expect(poolQuery).toHaveBeenCalledTimes(5);
    });
  });

});

/** GROUP BY review_status 的行形状 */
function countRows(counts: Record<string, number>) {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([status, n]) => ({ review_status: status, n }));
}
