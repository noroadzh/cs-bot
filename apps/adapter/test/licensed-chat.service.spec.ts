/**
 * LicensedChatService 单元测试
 *
 * M9 群数上限：覆盖 load / ensureChat / removeChat 全部分支：
 *   - load 成功装载 / 失败视为空集
 *   - ensureChat：已注册放行 / 未注册未超限注册 / 超限拒绝 /
 *     PG 故障放行（授权库故障不阻断消息）
 *   - removeChat：成功删除释放名额 / PG 故障保留记录
 * pg Pool 全 mock。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const poolQuery = jest.fn() as jest.MockedFunction<(sql: string, params?: unknown[]) => Promise<any>>;
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: poolQuery })),
}));

import { LicensedChatService } from '../src/license/licensed-chat.service.js';

/** 只用到 getState().maxChats */
function makeLicense(maxChats: number) {
  return { getState: () => ({ maxChats }) } as never;
}

describe('LicensedChatService', () => {
  beforeAll(() => setConfig());
  afterAll(() => resetConfig());
  beforeEach(() => {
    poolQuery.mockReset();
  });

  describe('load', () => {
    it('成功：装载已激活群到内存 Set', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [{ chat_id: 'c1' }, { chat_id: 'c2' }] });
      const svc = new LicensedChatService(makeLicense(0));

      await svc.load();

      expect(svc.getCount()).toBe(2);
      expect(svc.has('c1')).toBe(true);
      expect(svc.has('c2')).toBe(true);
      expect(svc.has('c3')).toBe(false);
    });

    it('PG 失败（表不存在）→ 视为空集，不向上抛', async () => {
      poolQuery.mockRejectedValueOnce(new Error('relation "licensed_chat" does not exist'));
      const svc = new LicensedChatService(makeLicense(0));

      await expect(svc.load()).resolves.toBeUndefined();
      expect(svc.getCount()).toBe(0);
    });
  });

  describe('ensureChat', () => {
    it('已注册 → 直接放行，不发 INSERT', async () => {
      poolQuery.mockResolvedValueOnce({ rows: [{ chat_id: 'c1' }] });
      const svc = new LicensedChatService(makeLicense(1));
      await svc.load();

      expect(await svc.ensureChat('c1', '群一')).toBe(true);
      expect(poolQuery).toHaveBeenCalledTimes(1); // 只有 load 的 SELECT
    });

    it('未注册 + 未超限 → INSERT 注册并放行', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [] }) // load 空集
        .mockResolvedValueOnce({ rows: [] }); // INSERT
      const svc = new LicensedChatService(makeLicense(5));
      await svc.load();

      expect(await svc.ensureChat('c1', '新群')).toBe(true);
      expect(svc.has('c1')).toBe(true);
      expect(svc.getCount()).toBe(1);
      expect(poolQuery.mock.calls[1][0]).toContain('INSERT INTO licensed_chat');
      expect(poolQuery.mock.calls[1][1]).toEqual(['c1', '新群']);
    });

    it('maxChats=0 → 不限制', async () => {
      poolQuery.mockResolvedValue({ rows: [] });
      const svc = new LicensedChatService(makeLicense(0));
      await svc.load();

      for (let i = 0; i < 3; i++) {
        expect(await svc.ensureChat(`c${i}`)).toBe(true);
      }
      expect(svc.getCount()).toBe(3);
    });

    it('已满（size >= maxChats）→ 拒绝且不发 INSERT', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ chat_id: 'c1' }] }) // load 满员
        .mockResolvedValueOnce({ rows: [] });
      const svc = new LicensedChatService(makeLicense(1));
      await svc.load();

      expect(await svc.ensureChat('c2', '多余群')).toBe(false);
      expect(svc.has('c2')).toBe(false);
      expect(poolQuery).toHaveBeenCalledTimes(1); // 无 INSERT
    });

    it('INSERT 抛错（PG 故障）→ 放行但不记入内存 Set', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const svc = new LicensedChatService(makeLicense(5));
      await svc.load();

      expect(await svc.ensureChat('c1')).toBe(true);
      expect(svc.has('c1')).toBe(false);
    });
  });

  describe('removeChat', () => {
    it('成功 → DELETE 并从内存 Set 删除，释放名额', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ chat_id: 'c1' }, { chat_id: 'c2' }] })
        .mockResolvedValueOnce({ rows: [] });
      const svc = new LicensedChatService(makeLicense(2));
      await svc.load();

      await svc.removeChat('c1');

      expect(svc.getCount()).toBe(1);
      expect(svc.has('c1')).toBe(false);
      expect(poolQuery.mock.calls[1][0]).toContain('DELETE FROM licensed_chat');
    });

    it('DELETE 抛错 → 保留内存记录，不向上抛', async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ chat_id: 'c1' }] })
        .mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const svc = new LicensedChatService(makeLicense(2));
      await svc.load();

      await expect(svc.removeChat('c1')).resolves.toBeUndefined();
      expect(svc.has('c1')).toBe(true);
    });
  });
});
