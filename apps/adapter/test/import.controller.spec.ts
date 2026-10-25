/**
 * ImportController 单元测试
 *
 * 覆盖 9 个端点（controller 使用 return 而非 res.json，直接 await 方法并断言返回值）：
 *  - POST   /admin/import-jobs               createFromFile
 *  - GET    /admin/import-jobs               listJobs
 *  - GET    /admin/import-jobs/counts         countJobsByStatus
 *  - GET    /admin/import-jobs/:jobId         getJobDetail
 *  - DELETE /admin/import-jobs/:jobId         deleteJob
 *  - POST   /admin/import-jobs/from-url       createFromUrl
 *  - POST   /admin/import-jobs/:jobId/parse   parseJob
 *  - GET    /admin/import-jobs/:jobId/items   listItems
 *  - PATCH  /admin/import-jobs/:jobId/items/:itemId  reviewItem
 *  - POST   /admin/import-jobs/:jobId/approve-all    approveAll
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ImportController } from '../src/import/import.controller.js';
import type { Express } from 'express';
import type {
  ImportJobCreated,
  ImportJobDetail,
} from '../src/import/import-job.service.js';
import type {
  ImportJob,
  ImportJobListQuery,
  ImportItemListQuery,
  ImportItem,
} from '../src/import/import-job.entity.js';

// ---------------------------------------------------------------------------
// 最小 mock service —— 只实现 controller 调用的方法
// ---------------------------------------------------------------------------
function makeSvc() {
  const svc: Record<string, jest.MockedFunction<any>> = {
    createFromFile: jest.fn(),
    listJobs: jest.fn(),
    countJobsByStatus: jest.fn(),
    getJobDetail: jest.fn(),
    deleteJob: jest.fn(),
    createFromUrl: jest.fn(),
    parseJob: jest.fn(),
    listItems: jest.fn(),
    reviewItem: jest.fn(),
    approveAll: jest.fn(),
    countItemsByStatus: jest.fn(),
  };
  return svc;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImportController', () => {
  let svc: ReturnType<typeof makeSvc>;
  let ctrl: ImportController;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeSvc();
    ctrl = new ImportController(svc as any);
  });

  // ---- createFromFile ----

  describe('createFromFile', () => {
    const file: Express.Multer.File = {
      originalname: 'a.csv',
      mimetype: 'text/csv',
      buffer: Buffer.alloc(10),
      size: 10,
      fieldname: 'file',
      destination: '',
      encoding: '7bit',
      filename: '',
      stream: undefined as any,
      path: '',
    };

    it('无文件 → 抛 400 HttpException', async () => {
      const mockReq = {} as any;
      await expect(ctrl.createFromFile(mockReq, undefined, 'x')).rejects.toThrow(
        HttpException,
      );
      const err = (await ctrl.createFromFile(mockReq, undefined, 'x').catch(
        (e: Error) => e,
      )) as HttpException;
      expect(err.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      // controller 实际抛 'IMPORT_NO_FILE' + 'no file uploaded'
      const body = err.getResponse() as { errCode: string; detail: string };
      expect(body.errCode).toBe('IMPORT_NO_FILE');
      expect(body.detail).toBe('no file uploaded');
    });

    it('有文件 → 调用 svc.createFromFile 并返回 job', async () => {
      svc.createFromFile.mockResolvedValue({
        job: { id: 'job-1', name: 'a.csv', sourceFilename: 'a.csv', status: 'uploaded', sourceHash: '', itemCount: 0, parseError: null, createdAt: '', updatedAt: '' },
        reused: false,
        storedPath: '/data/imports/job-1',
        mimeType: 'text/csv',
      } as ImportJobCreated);
      const res = await ctrl.createFromFile({} as any, file as any, 'x');
      expect(svc.createFromFile).toHaveBeenCalledTimes(1);
      const callArg = svc.createFromFile.mock.calls[0][0];
      expect(callArg.filename).toBe('a.csv');
      expect(callArg.mimeType).toBe('text/csv');
      expect(Buffer.isBuffer(callArg.bytes)).toBe(true);
      expect(callArg.name).toBe('x');
      expect(res.job.id).toBe('job-1');
    });
  });

  // ---- listJobs ----

  describe('listJobs', () => {
    it('透传 query → 返回 job 列表', async () => {
      svc.listJobs.mockResolvedValue([
        { id: 'j1', status: 'uploaded' } as ImportJob,
        { id: 'j2', status: 'parsed' } as ImportJob,
      ]);
      const res = await ctrl.listJobs({ status: 'uploaded', page: 1, pageSize: 10 } as ImportJobListQuery);
      expect(svc.listJobs).toHaveBeenCalledWith({ status: 'uploaded', limit: 10, offset: 0 });
      expect(res).toHaveLength(2);
    });
  });

  // ---- countJobsByStatus ----

  describe('countJobs', () => {
    it('返回各状态计数', async () => {
      svc.countJobsByStatus.mockResolvedValue({
        uploaded: 1, parsing: 0, parsed: 2, reviewing: 1, approved: 0, rejected: 0, failed: 0,
      } as any);
      const res = await ctrl.countJobs();
      expect(res.uploaded).toBe(1);
      expect(res.parsed).toBe(2);
    });
  });

  // ---- getJobDetail ----

  describe('getJobDetail', () => {
    it('job 存在 → 返回 detail', async () => {
      svc.getJobDetail.mockResolvedValue({
        job: { id: 'j1', name: 'a.csv', sourceFilename: 'a.csv', status: 'parsed', sourceHash: '', itemCount: 3, parseError: null, createdAt: '', updatedAt: '' },
        itemCounts: { pending: 3, approved: 0, rejected: 0, 'needs-fix': 0 },
        deletable: true,
      } as ImportJobDetail);
      const res = await ctrl.getJobDetail('j1');
      expect(svc.getJobDetail).toHaveBeenCalledWith('j1');
      expect(res.job.id).toBe('j1');
    });

    it('job 不存在 → 抛 404 NotFoundException', async () => {
      svc.getJobDetail.mockResolvedValue(null);
      const err = (await ctrl.getJobDetail('missing').catch((e: Error) => e)) as HttpException;
      expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
      const body = err.getResponse() as { errCode: string; detail: string };
      expect(body.errCode).toBe('IMPORT_JOB_NOT_FOUND');
      expect(body.detail).toContain('missing');
    });
  });

  // ---- deleteJob ----

  describe('deleteJob', () => {
    it('可删任务 → 成功（@HttpCode 204）', async () => {
      svc.deleteJob.mockResolvedValue(undefined);
      const res = await ctrl.deleteJob('j1');
      expect(svc.deleteJob).toHaveBeenCalledWith('j1');
      expect(res).toBeUndefined();
    });
  });

  // ---- createFromUrl ----

  describe('createFromUrl', () => {
    it('合法 URL → 201 + job', async () => {
      svc.createFromUrl.mockResolvedValue({
        job: { id: 'j-url', name: 'remote.csv', sourceFilename: 'remote.csv', status: 'uploaded', sourceHash: '', itemCount: 0, parseError: null, createdAt: '', updatedAt: '' },
        reused: false,
        storedPath: '/data/imports/j-url',
        mimeType: 'text/csv',
      } as ImportJobCreated);
      const res = await ctrl.createFromUrl({ url: 'https://example.com/a.csv', name: undefined });
      expect(svc.createFromUrl).toHaveBeenCalledWith('https://example.com/a.csv', undefined);
      expect(res.job.id).toBe('j-url');
    });
  });

  // ---- parseJob ----

  describe('parseJob', () => {
    it('解析成功 → 返回 { id, status }', async () => {
      svc.parseJob.mockResolvedValue({
        id: 'j1', name: 'a.csv', sourceFilename: 'a.csv', status: 'parsed',
        sourceHash: '', itemCount: 3, parseError: null, createdAt: '', updatedAt: '',
      } as ImportJob);
      const res = await ctrl.parseJob('j1');
      expect(res.id).toBe('j1');
      expect(res.status).toBe('parsed');
    });
  });

  // ---- listItems ----

  describe('listItems', () => {
    it('透传 query → 返回 item 列表', async () => {
      svc.listItems.mockResolvedValue({
        items: [
          { id: 'i1', jobId: 'j1', question: 'q', answerRaw: 'a', answerRedacted: 'a', sensitiveFlags: [], reviewStatus: 'pending', reviewedAt: null, reviewerNote: null, createdAt: '' },
          { id: 'i2', jobId: 'j1', question: 'q', answerRaw: 'a', answerRedacted: 'a', sensitiveFlags: [], reviewStatus: 'approved', reviewedAt: null, reviewerNote: null, createdAt: '' },
        ],
        total: 2, limit: 20, offset: 0,
      });
      const res = await ctrl.listItems('j1', { status: 'pending', page: 1, pageSize: 20 } as any);
      expect(svc.listItems).toHaveBeenCalledWith('j1', { reviewStatus: 'pending', limit: 20, offset: 0 });
      expect(res.items).toHaveLength(2);
    });
  });

  // ---- reviewItem ----

  describe('reviewItem', () => {
    it('approved → 返回更新后的 item', async () => {
      svc.reviewItem.mockResolvedValue({
        id: 'i1', jobId: 'j1', question: 'q?', answerRaw: 'a.', answerRedacted: 'a.',
        sensitiveFlags: [], reviewStatus: 'approved', reviewedAt: '2026-10-01T00:00:00Z', reviewerNote: 'ok',
        createdAt: '',
      } as ImportItem);
      const res = await ctrl.reviewItem(
        'j1', 'i1',
        { reviewStatus: 'approved', note: 'ok' } as any,
      );
      expect(svc.reviewItem).toHaveBeenCalledWith('j1', 'i1', {
        reviewStatus: 'approved', note: 'ok',
      });
      expect(res.reviewStatus).toBe('approved');
    });
  });

  // ---- approveAll ----

  describe('approveAll', () => {
    it('返回三计数', async () => {
      svc.approveAll.mockResolvedValue({
        approved: 5, skippedSensitive: 1, skippedNotPending: 0,
      } as any);
      const res = await ctrl.approveAll('j1');
      expect(svc.approveAll).toHaveBeenCalledWith('j1');
      expect(res.approved).toBe(5);
      expect(res.skippedSensitive).toBe(1);
      expect(res.skippedNotPending).toBe(0);
    });
  });
});
