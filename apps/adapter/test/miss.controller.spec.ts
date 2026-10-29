/**
 * MissController 单元测试（src/admin/miss.controller.ts，分支覆盖率 0% → 100%）
 *
 * 覆盖两处分支：
 * - days 为空 → 默认 90；days 有值 → parseInt 结果
 * - format 为空 / 'json' / 'JSON'（大小写不敏感）/ 'csv' → 走 JSON 分支
 * - format='xlsx' → 走 exportXlsx 分支并提前 return
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { Response } from 'express';
import { MissController } from '../src/admin/miss.controller.js';

function makeRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    payload: undefined as unknown,
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
    json: jest.fn((p: unknown) => {
      res.payload = p;
      return res;
    }),
  };
  return res;
}

function makeExport() {
  return {
    exportXlsx: jest.fn<any>(() => Promise.resolve()),
    queryRecords: jest.fn<any>(() => Promise.resolve([{ traceId: 't-1' }, { traceId: 't-2' }])),
    queryItems: jest.fn<any>(() => Promise.resolve([{ question: 'q-1', userId: 'wx****23' }, { question: 'q-2', userId: 'ab****yz' }])),
  } as any;
}

describe('MissController.list', () => {
  let exportService: any;
  let controller: MissController;

  beforeEach(() => {
    jest.clearAllMocks();
    exportService = makeExport();
    controller = new MissController(exportService);
  });

  describe('分支: days 参数', () => {
    it('days 为空 → 默认 90 天', async () => {
      const res = makeRes();
      await controller.list({}, res as unknown as Response);

      expect(exportService.queryItems).toHaveBeenCalledWith(90, undefined);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(res.payload).toEqual({
        total: 2,
        items: [{ question: 'q-1', userId: 'wx****23' }, { question: 'q-2', userId: 'ab****yz' }],
      });
    });

    it('days=7 → parseInt 得 7', async () => {
      const res = makeRes();
      await controller.list({ days: '7' }, res as unknown as Response);

      expect(exportService.queryItems).toHaveBeenCalledWith(7, undefined);
    });

    it('days=30 → parseInt 得 30', async () => {
      const res = makeRes();
      await controller.list({ days: '30' }, res as unknown as Response);

      expect(exportService.queryItems).toHaveBeenCalledWith(30, undefined);
    });
  });

  describe('分支: format 参数', () => {
    it('format 为空 → 走 JSON 分支', async () => {
      const res = makeRes();
      await controller.list({ days: '90' }, res as unknown as Response);

      expect(exportService.exportXlsx).not.toHaveBeenCalled();
      expect(exportService.queryItems).toHaveBeenCalled();
    });

    it('format=json → 走 JSON 分支', async () => {
      const res = makeRes();
      await controller.list({ format: 'json', days: '90' }, res as unknown as Response);

      expect(exportService.exportXlsx).not.toHaveBeenCalled();
      expect(exportService.queryItems).toHaveBeenCalled();
    });

    it('format=JSON（大写）→ 大小写不敏感，仍走 JSON 分支', async () => {
      const res = makeRes();
      await controller.list({ format: 'JSON', days: '90' }, res as unknown as Response);

      expect(exportService.exportXlsx).not.toHaveBeenCalled();
      expect(exportService.queryItems).toHaveBeenCalled();
    });

    it('format=csv → 非 xlsx，走 JSON 分支', async () => {
      const res = makeRes();
      await controller.list({ format: 'csv', days: '90' }, res as unknown as Response);

      expect(exportService.exportXlsx).not.toHaveBeenCalled();
      expect(exportService.queryItems).toHaveBeenCalled();
    });

    it('format=xlsx → 走 exportXlsx 且提前 return（不查记录、不写 JSON）', async () => {
      const res = makeRes();
      await controller.list({ format: 'xlsx', days: '7' }, res as unknown as Response);

      expect(exportService.exportXlsx).toHaveBeenCalledWith(7, expect.any(Object), undefined);
      expect(exportService.queryRecords).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });

  describe('边界: records 为空数组', () => {
    it('queryItems 返回空数组 → total=0, items=[]', async () => {
      exportService.queryItems.mockResolvedValue([]);
      const res = makeRes();
      await controller.list({}, res as unknown as Response);

      expect(res.payload).toEqual({ total: 0, items: [] });
    });
  });
});