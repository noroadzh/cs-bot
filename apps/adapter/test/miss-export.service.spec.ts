/**
 * MissExportService 单元测试
 * 覆盖：queryRecords 签名、exportXlsx 接受 Writable res、不抛同步错误、header 正确
 *
 * 注意：本套件不连真实 DB（DATABASE_URL 指向不存在的 PG），
 * exportXlsx 的策略是 DB 错误降级为 WARN 并 resolve，因此断言 resolve 而非 reject。
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { PassThrough } from 'stream';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

beforeAll(() => setConfig());
afterAll(() => resetConfig());

/** 构造一个既可写（ExcelJS WorkbookWriter 需要）又能记录 header 的 res */
function makeMockRes(): PassThrough & { headers: Record<string, string>; setHeader: (k: string, v: string) => void } {
  const stream = new PassThrough() as PassThrough & { headers: Record<string, string>; setHeader: (k: string, v: string) => void };
  stream.headers = {};
  stream.setHeader = (k: string, v: string) => { stream.headers[k] = v; };
  // 消费掉写入数据，避免背压/缓冲区堆积
  stream.resume();
  return stream;
}

describe('MissExportService', () => {
  it('3.6.a queryRecords 返回 Promise（无真实 DB 时 reject，被调用方处理）', async () => {
    const { MissExportService } = await import('../src/miss/miss-export.service.js');
    const svc = new MissExportService({} as any);
    const promise = svc.queryRecords(90);
    expect(promise).toBeInstanceOf(Promise);
    // 无真实 DB 时连接失败，reject 的原因值不确定（可能是 undefined/Error），
    // 因此只要「不抛同步错误且最终 reject」即视为符合契约
    let rejected = false;
    try {
      await promise;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('3.6.b exportXlsx 接受 Writable 作为 res 参数，DB 错误降级为 WARN 不 reject', async () => {
    const { MissExportService } = await import('../src/miss/miss-export.service.js');
    const svc = new MissExportService({} as any);
    const stream = makeMockRes();
    await expect(svc.exportXlsx(7, stream as any)).resolves.toBeUndefined();
  });

  it('3.6.c exportXlsx 设置正确的 Content-Type / Content-Disposition header', async () => {
    const { MissExportService } = await import('../src/miss/miss-export.service.js');
    const svc = new MissExportService({} as any);
    const mockRes = makeMockRes();
    await expect(svc.exportXlsx(30, mockRes)).resolves.toBeUndefined();
    expect(mockRes.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(mockRes.headers['Content-Disposition']).toMatch(/attachment; filename="miss-records_/);
  });
});