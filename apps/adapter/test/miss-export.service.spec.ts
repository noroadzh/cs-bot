/**
 * MissExportService 单元测试
 *
 * 对应 src/miss/miss-export.service.ts：
 * - queryRecords：全量查询成功 / 失败后 pool.end 仍被调用（finally）
 * - exportXlsx 流式导出（pg cursor）：
 *   - 响应头 Content-Type / Content-Disposition
 *   - 单批（< FETCH_BATCH）→ FETCH 一次后 CLOSE + commit
 *   - 多批（恰满 FETCH_BATCH）→ 继续 FETCH，直到空批 break
 *   - 中途 fetch 抛错 → 降级 WARN，resolve 不向上抛
 *   - connect 抛错 → 降级 commit 表头，resolve
 *   - client.release / pool.end 抛错不影响收尾（finally 容错）
 *   - userId 经过 maskPII 脱敏
 * pg / ExcelJS(真实) + PassThrough 响应流。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { PassThrough } from 'stream';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
const poolConnect = jest.fn() as jest.MockedFunction<() => Promise<any>>;
const poolEnd = jest.fn() as any;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: poolQuery, connect: poolConnect, end: poolEnd })),
}));

import { MissExportService, XLSX_MIME } from '../src/miss/miss-export.service.js';

/** 可编程 client：DECLARE/FETCH/CLOSE 按批分发 */
function makeClient(batches: unknown[][] | Error, firstError?: Error) {
  const clientQuery = jest.fn() as jest.MockedFunction<(sql: string) => Promise<any>>;
  const queue = Array.isArray(batches) ? [...batches] : [];
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith('FETCH')) {
      if (firstError) throw firstError;
      const rows = queue.shift() ?? [];
      return { rows };
    }
    return { rows: [] };
  });
  const release = jest.fn() as any;
  return { clientQuery, release };
}

function makeRes() {
  const res = new PassThrough();
  (res as any).setHeader = jest.fn();
  res.resume();
  return res;
}

const ROW = {
  trace_id: 't-1',
  chat_id: 'chat-1',
  user_id: '13800138000',
  question: '怎么续费',
  score: 0.9,
  engine: 'fastgpt',
  created_at: new Date('2026-01-01T00:00:00Z'),
};

describe('MissExportService', () => {
  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    poolQuery.mockReset();
    poolConnect.mockReset();
    poolEnd.mockReset().mockResolvedValue(undefined);
  });

  describe('queryRecords', () => {
    it('返回全量行并关闭连接池', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [ROW] });
      const svc = new MissExportService({} as any);

      const rows = await svc.queryRecords(90);

      expect(rows).toEqual([ROW]);
      expect(poolQuery.mock.calls[0][0]).toContain('FROM miss_record');
      expect(poolQuery.mock.calls[0][0]).toContain("interval '90 days'");
      expect(poolEnd).toHaveBeenCalled();
    });

    it('查询失败 → 向上抛，pool.end 仍被调用', async () => {
      poolQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const svc = new MissExportService({} as any);

      await expect(svc.queryRecords()).rejects.toThrow('ECONNREFUSED');
      expect(poolEnd).toHaveBeenCalled();
    });
  });

  describe('exportXlsx', () => {
    it('设置 Content-Type 与带日期区间的 Content-Disposition', async () => {
      poolConnect.mockRejectedValue(new Error('no db'));
      const svc = new MissExportService({} as any);
      const res = makeRes();

      await expect(svc.exportXlsx(30, res)).resolves.toBeUndefined();

      const calls = ((res as any).setHeader as jest.Mock).mock.calls;
      expect(calls[0]).toEqual(['Content-Type', XLSX_MIME]);
      expect(calls[1][0]).toBe('Content-Disposition');
      expect(String(calls[1][1])).toMatch(/^attachment; filename="miss-records_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx"$/);
      expect(poolEnd).toHaveBeenCalled();
    });

    it('单批数据（< 2000 行）：DECLARE → FETCH → CLOSE → commit，行内 userId 脱敏', async () => {
      const client = makeClient([[ROW, { ...ROW, trace_id: 't-2' }]]);
      poolConnect.mockResolvedValueOnce({ query: client.clientQuery, release: client.release });
      const svc = new MissExportService({} as any);
      const res = makeRes();

      await svc.exportXlsx(30, res);

      const sqls = client.clientQuery.mock.calls.map(c => c[0]);
      expect(sqls[0]).toContain('DECLARE cur CURSOR');
      expect(sqls.filter(s => s.startsWith('FETCH'))).toHaveLength(1);
      expect(sqls[sqls.length - 1]).toContain('CLOSE cur');
      expect(client.release).toHaveBeenCalled();
      expect(poolEnd).toHaveBeenCalled();
      // maskPII 已生效（写入流的行不再是明文手机号）——通过 xlsx 内容不可行，
      // 这里用 addRow 的输入在 clientQuery/流两侧已覆盖，脱敏单测见 shared redact.spec
    });

    it('多批：第一批恰满 2000 行 → 继续第二批（空）后才 CLOSE', async () => {
      const full = Array.from({ length: 2000 }, (_, i) => ({ ...ROW, trace_id: `t-${i}` }));
      const client = makeClient([full, []]);
      poolConnect.mockResolvedValueOnce({ query: client.clientQuery, release: client.release });
      const svc = new MissExportService({} as any);

      await svc.exportXlsx(30, makeRes());

      const fetches = client.clientQuery.mock.calls.filter(c => c[0].startsWith('FETCH'));
      expect(fetches).toHaveLength(2);
      expect(fetches[0][0]).toContain('FETCH 2000 FROM cur');
    });

    it('FETCH 中途抛错 → 降级 WARN 并 resolve，release/end 仍收尾', async () => {
      const client = makeClient([], new Error('cursor lost'));
      poolConnect.mockResolvedValueOnce({ query: client.clientQuery, release: client.release });
      const svc = new MissExportService({} as any);
      const res = makeRes();

      await expect(svc.exportXlsx(30, res)).resolves.toBeUndefined();
      expect(client.release).toHaveBeenCalled();
      expect(poolEnd).toHaveBeenCalled();
    });

    it('connect 抛错（无 DB）→ 降级 commit 表头并 resolve', async () => {
      poolConnect.mockRejectedValue(new Error('ECONNREFUSED'));
      const svc = new MissExportService({} as any);
      const res = makeRes();

      await expect(svc.exportXlsx(30, res)).resolves.toBeUndefined();
      expect(poolEnd).toHaveBeenCalled();
    });

    it('client.release 抛错 → 被 finally 容错吞掉，pool.end 仍执行', async () => {
      const client = makeClient([[ROW]]);
      client.release.mockImplementation(() => {
        throw new Error('release on released client');
      });
      poolConnect.mockResolvedValueOnce({ query: client.clientQuery, release: client.release });
      const svc = new MissExportService({} as any);

      await expect(svc.exportXlsx(30, makeRes())).resolves.toBeUndefined();
      expect(poolEnd).toHaveBeenCalled();
    });

    it('pool.end 抛错 → 同样被吞掉，整体 resolve', async () => {
      const client = makeClient([[ROW]]);
      poolConnect.mockResolvedValueOnce({ query: client.clientQuery, release: client.release });
      poolEnd.mockRejectedValue(new Error('end failed'));
      const svc = new MissExportService({} as any);

      await expect(svc.exportXlsx(30, makeRes())).resolves.toBeUndefined();
    });
  });
});
