/**
 * AssetService 单元测试
 *
 * 覆盖 createFromFile/createFromLink/findById/findAll/delete 全部分支：
 * 413 超限、415 MIME 白名单、PG CRUD、文件 unlink 及其容错、mkdir 失败容错。
 * pg Pool 与 fs/promises 全部 mock，不依赖真实 DB / 磁盘。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

// pg Pool mock：所有实例共享一个 query 桩，通过 poolQuery 控制返回
const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: poolQuery })),
}));

// fs/promises mock：asset.service 以 `import { promises as fs } from 'fs'` 引用
const fsMkdir = jest.fn() as any;
const fsWriteFile = jest.fn() as any;
const fsUnlink = jest.fn() as any;
jest.mock('fs', () => ({
  promises: { mkdir: fsMkdir, writeFile: fsWriteFile, unlink: fsUnlink },
}));

import { Pool } from 'pg';
import { AssetService } from '../src/media/asset.service.js';

const ROW = {
  id: 'a1b2c3d4-0000-1111-2222-333344445555',
  type: 'file',
  name: 'demo.png',
  url: '/assets/a1b2c3d4-0000-1111-2222-333344445555.png',
  size: 1024,
  created_at: new Date('2026-01-01T00:00:00Z'),
};

describe('AssetService', () => {
  let svc: AssetService;

  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    poolQuery.mockReset();
    fsMkdir.mockReset().mockResolvedValue(undefined);
    fsWriteFile.mockReset().mockResolvedValue(undefined);
    fsUnlink.mockReset().mockResolvedValue(undefined);
    svc = new AssetService({} as any);
  });

  describe('构造', () => {
    it('创建 Pool 并确保 data/assets 目录存在', () => {
      expect(Pool).toHaveBeenCalled();
      expect(fsMkdir).toHaveBeenCalledWith(expect.stringContaining('data'), { recursive: true });
    });

    it('mkdir 失败不抛出（仅记日志）', async () => {
      fsMkdir.mockRejectedValueOnce(new Error('EACCES'));
      expect(() => new AssetService({} as any)).not.toThrow();
      await new Promise(r => setTimeout(r, 0));
    });
  });

  describe('createFromFile', () => {
    it('容量守卫拒绝时不落盘', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      const guard = { checkAsset: jest.fn(async () => { throw new HttpException({ errCode: 'TENANT_QUOTA_EXCEEDED' }, HttpStatus.CONFLICT); }) };
      const guarded = new AssetService({} as any, guard as any);
      let status = 0;
      try {
        await guarded.createFromFile(Buffer.from('x'), 'a.png', 'image/png');
      } catch (e) {
        status = (e as HttpException).getStatus();
      }
      expect(status).toBe(409);
      expect(fsWriteFile).not.toHaveBeenCalled();
    });


    it('容量守卫校验通过后正常落盘', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [ROW] });
      const guard = { checkAsset: jest.fn(async (_bytes: number) => undefined) };
      const guarded = new AssetService({} as any, guard as any);
      const buf = Buffer.from('hello');

      await guarded.createFromFile(buf, 'demo.png', 'image/png');

      expect(guard.checkAsset).toHaveBeenCalledWith(5);
      expect(fsWriteFile).toHaveBeenCalledWith(expect.stringMatching(/data[\\/]assets/), buf, { mode: 0o600 });
    });

    it('成功：写文件 + INSERT + 返回映射后的 Asset', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [ROW] });
      const buf = Buffer.from('hello');

      const asset = await svc.createFromFile(buf, 'demo.png', 'image/png');

      expect(fsWriteFile).toHaveBeenCalledWith(expect.stringMatching(/data[\\/]assets/), buf, { mode: 0o600 });
      expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO asset'), [
        expect.any(String),
        'file',
        'demo.png',
        expect.stringMatching(/^\/assets\//),
        5,
        expect.any(String),
      ]);
      expect(asset).toEqual({
        id: ROW.id,
        type: 'file',
        name: 'demo.png',
        url: ROW.url,
        size: 1024,
        createdAt: ROW.created_at,
      });
    });

    it('视频超过 10MB → 413 ASSET_TOO_LARGE', async () => {
      const big = Buffer.alloc(10 * 1024 * 1024 + 1);
      await expect(svc.createFromFile(big, 'v.mp4', 'video/mp4')).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
      });
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('相同 md5 重复上传 → 返回已有素材，不重复落盘', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [ROW] });
      const asset = await svc.createFromFile(Buffer.from('hello'), 'demo.png', 'image/png');
      expect(asset.id).toBe(ROW.id);
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('超过 20MB → 413 ASSET_TOO_LARGE，不写文件不进库', async () => {
      const big = Buffer.alloc(20 * 1024 * 1024 + 1);

      await expect(svc.createFromFile(big, 'big.png', 'image/png')).rejects.toMatchObject({
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        response: { errCode: 'ASSET_TOO_LARGE' },
      });
      expect(fsWriteFile).not.toHaveBeenCalled();
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it('MIME 不在白名单 → 415 UNSUPPORTED_MEDIA_TYPE', async () => {
      await expect(
        svc.createFromFile(Buffer.from('x'), 'evil.exe', 'application/x-msdownload'),
      ).rejects.toMatchObject({
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        response: { errCode: 'UNSUPPORTED_MEDIA_TYPE' },
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });
  });

  describe('createFromLink', () => {
    it('成功：type=link、url 为外部地址、size=null', async () => {
      const linkRow = { ...ROW, type: 'link', url: 'https://cdn.example.com/x.pdf', size: null };
      poolQuery.mockResolvedValueOnce({ rows: [linkRow] });

      const asset = await svc.createFromLink('https://cdn.example.com/x.pdf', '手册');

      expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO asset'), [
        expect.any(String),
        'link',
        '手册',
        'https://cdn.example.com/x.pdf',
        null,
      ]);
      expect(asset.type).toBe('link');
      expect(asset.size).toBeNull();
    });
  });

  describe('findById', () => {
    it('命中 → 返回映射 Asset', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [ROW] });
      const asset = await svc.findById(ROW.id);
      expect(asset?.id).toBe(ROW.id);
    });

    it('未命中 → null', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      expect(await svc.findById('nope')).toBeNull();
    });
  });

  describe('findAll', () => {
    it('默认 limit=50 offset=0，返回 total 与映射行', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rows: [ROW] });

      const res = await svc.findAll();

      expect(res).toEqual({
        total: 3,
        limit: 50,
        offset: 0,
        rows: [expect.objectContaining({ id: ROW.id })],
      });
      expect(poolQuery.mock.calls[1][1]).toEqual([50, 0]);
    });

    it('limit 超过 100 被钳制为 100', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await svc.findAll({ limit: 500, offset: 20 });

      expect(res.limit).toBe(100);
      expect(poolQuery.mock.calls[1][1]).toEqual([100, 20]);
    });
  });

  describe('delete', () => {
    it('资产不存在 → false，不删库', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [] });
      expect(await svc.delete('nope')).toBe(false);
      expect(poolQuery).toHaveBeenCalledTimes(1);
    });

    it('file 类型：unlink 文件 + DELETE 返回 true', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [ROW] }) // findById
        .mockResolvedValueOnce({ rows: [] }); // DELETE

      expect(await svc.delete(ROW.id)).toBe(true);
      expect(fsUnlink).toHaveBeenCalledWith(expect.stringContaining(ROW.id));
      expect(poolQuery.mock.calls[1][0]).toContain('DELETE FROM asset');
    });

    it('file 类型但 unlink 失败（文件已不在）→ 仍删库返回 true', async () => {
      fsUnlink.mockRejectedValueOnce(new Error('ENOENT'));
      poolQuery
        .mockResolvedValueOnce({ rows: [ROW] })
        .mockResolvedValueOnce({ rows: [] });

      expect(await svc.delete(ROW.id)).toBe(true);
      expect(poolQuery.mock.calls[1][0]).toContain('DELETE FROM asset');
    });

    it('video 类型：unlink 落盘文件 + DELETE 返回 true', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ ...ROW, type: 'video', url: `/assets/${ROW.id}.mp4` }] })
        .mockResolvedValueOnce({ rows: [] });

      expect(await svc.delete(ROW.id)).toBe(true);
      expect(fsUnlink).toHaveBeenCalledWith(expect.stringContaining(`${ROW.id}.mp4`));
      expect(poolQuery.mock.calls[1][0]).toContain('DELETE FROM asset');
    });

    it('link 类型：不触发 unlink', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ ...ROW, type: 'link', url: 'https://x/y.pdf' }] })
        .mockResolvedValueOnce({ rows: [] });

      expect(await svc.delete(ROW.id)).toBe(true);
      expect(fsUnlink).not.toHaveBeenCalled();
    });
  });

  describe('辅助方法', () => {
    it('resolvePath 返回 data/assets 下的路径', () => {
      expect(svc.resolvePath('abc.png')).toContain('abc.png');
    });

    it('isSupportedMediaType 白名单判断', () => {
      expect(svc.isSupportedMediaType('image/png')).toBe(true);
      expect(svc.isSupportedMediaType('video/mp4')).toBe(true);
      expect(svc.isSupportedMediaType('application/zip')).toBe(false);
    });
  });
});
