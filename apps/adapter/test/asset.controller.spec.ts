/**
 * Asset Controller 单元测试
 * 覆盖：上传（multipart / JSON）、列表分页、详情、删除、错误分支
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AssetController } from '../src/media/asset.controller.js';
import type { AssetService } from '../src/media/asset.service.js';
import type { Asset } from '../src/media/asset.entity.js';

const SAMPLE: Asset = {
  id: '11111111-2222-3333-4444-555555555555',
  type: 'file',
  name: 'demo.png',
  url: '/assets/11111111-2222-3333-4444-555555555555.png',
  size: 1024,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function makeService(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    createFromFile: jest.fn(async () => SAMPLE),
    createFromLink: jest.fn(async () => ({ ...SAMPLE, type: 'link', url: 'https://x/y.pdf', size: null })),
    findById: jest.fn(async () => SAMPLE),
    findAll: jest.fn(async () => ({ total: 1, limit: 50, offset: 0, rows: [SAMPLE] })),
    delete: jest.fn(async () => true),
    ...overrides,
  } as unknown as AssetService;
}

function makeReq(headers: Record<string, string>, body: unknown = {}) {
  return { headers, body } as never;
}

describe('AssetController', () => {
  let service: AssetService;
  let controller: AssetController;

  beforeEach(() => {
    service = makeService();
    controller = new AssetController(service);
  });

  describe('POST /admin/assets', () => {
    it('multipart 上传文件返回 201 语义的 success 包装', async () => {
      const req = {
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: {},
        file: { buffer: Buffer.from('abc'), originalname: 'demo.png', mimetype: 'image/png' },
      } as never;

      const res = await controller.create(req);

      expect(res).toEqual({ success: true, asset: SAMPLE });
      expect(service.createFromFile).toHaveBeenCalledWith(
        Buffer.from('abc'),
        'demo.png',
        'image/png',
      );
    });

    it('multipart 但无文件 → 400 NO_FILE', async () => {
      const req = {
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
        body: {},
      } as never;

      await expect(controller.create(req)).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
    });

    it('JSON 缺 url → 400', async () => {
      const req = makeReq({ 'content-type': 'application/json' }, { name: 'only-name' });

      await expect(controller.create(req)).rejects.toThrow(HttpException);
    });

    it('JSON 缺 name → 400', async () => {
      const req = makeReq({ 'content-type': 'application/json' }, { url: 'https://x/y.pdf' });

      await expect(controller.create(req)).rejects.toThrow(HttpException);
    });

    it('JSON 带 url+name → 创建 link 类型素材', async () => {
      const req = makeReq(
        { 'content-type': 'application/json' },
        { url: 'https://x/y.pdf', name: '手册.pdf' },
      );

      const res = await controller.create(req);

      expect(res.success).toBe(true);
      expect((res as { asset: Asset }).asset.type).toBe('link');
      expect(service.createFromLink).toHaveBeenCalledWith('https://x/y.pdf', '手册.pdf');
    });

    it('上传超限由 service 抛出 → 异常向上传播', async () => {
      service = makeService({
        createFromFile: jest.fn(async () => {
          throw new HttpException({ errCode: 'ASSET_TOO_LARGE' }, HttpStatus.PAYLOAD_TOO_LARGE);
        }),
      });
      controller = new AssetController(service);

      const req = {
        headers: { 'content-type': 'multipart/form-data' },
        body: {},
        file: { buffer: Buffer.alloc(1), originalname: 'big.mp4', mimetype: 'video/mp4' },
      } as never;

      await expect(controller.create(req)).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      });
    });

    it('不支持的 MIME → 415', async () => {
      service = makeService({
        createFromFile: jest.fn(async () => {
          throw new HttpException({ errCode: 'UNSUPPORTED_MEDIA_TYPE' }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
        }),
      });
      controller = new AssetController(service);

      const req = {
        headers: { 'content-type': 'multipart/form-data' },
        body: {},
        file: { buffer: Buffer.from('x'), originalname: 'a.exe', mimetype: 'application/x-msdownload' },
      } as never;

      await expect(controller.create(req)).rejects.toMatchObject({
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      });
    });
  });

  describe('GET /admin/assets', () => {
    it('默认分页 50/0', async () => {
      const res = await controller.list(undefined, undefined);

      expect(res).toEqual({ success: true, total: 1, limit: 50, offset: 0, assets: [SAMPLE] });
      expect(service.findAll).toHaveBeenCalledWith({ limit: undefined, offset: undefined });
    });

    it('解析 limit/offset 字符串为整数', async () => {
      await controller.list('20', '40');

      expect(service.findAll).toHaveBeenCalledWith({ limit: 20, offset: 40 });
    });

    it('非法数字回退为 undefined（由 service 归一化）', async () => {
      await controller.list('abc', 'xyz');

      expect(service.findAll).toHaveBeenCalledWith({ limit: undefined, offset: undefined });
    });
  });

  describe('GET /admin/assets/:id', () => {
    it('命中返回素材', async () => {
      const res = await controller.get(SAMPLE.id);

      expect(res).toEqual({ success: true, asset: SAMPLE });
      expect(service.findById).toHaveBeenCalledWith(SAMPLE.id);
    });

    it('未命中 → 404', async () => {
      service = makeService({ findById: jest.fn(async () => null) });
      controller = new AssetController(service);

      await expect(controller.get(SAMPLE.id)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  describe('DELETE /admin/assets/:id', () => {
    it('删除成功返回 deleted: true', async () => {
      const res = await controller.delete(SAMPLE.id);

      expect(res).toEqual({ success: true, deleted: true });
      expect(service.delete).toHaveBeenCalledWith(SAMPLE.id);
    });

    it('删除不存在的素材 → 404', async () => {
      service = makeService({ delete: jest.fn(async () => false) });
      controller = new AssetController(service);

      await expect(controller.delete(SAMPLE.id)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });
  });
});
