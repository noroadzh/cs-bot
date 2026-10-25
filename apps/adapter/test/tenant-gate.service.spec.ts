/**
 * TenantGateService 单元测试（M11 数据面租户准入）
 *
 * 覆盖：
 *   - TENANT_ID 空 → 放行且不查库
 *   - 租户不存在 → 放行（配置错误容错）
 *   - 租户 paused / terminated → tenant-inactive
 *   - active + 非新群 + api_call 充足 → 放行（消耗 1 次）
 *   - 新群 + chat/api_call 均充足 → 放行（消耗 2 次）
 *   - 新群 chat 超限 → tenant-chat-limit（不再消耗 api_call）
 *   - 消息 api_call 超限 → tenant-msg-limit
 *   - DB 故障 → 放行（不阻断消息）
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpException, HttpStatus } from '@nestjs/common';

const poolQuery = jest.fn() as jest.MockedFunction<
  (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>
>;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: (sql: string, params?: unknown[]) => poolQuery(sql, params),
  })),
}));

jest.mock('../src/platform/tenant-quota.service.js', () => ({
  consumeQuota: jest.fn(),
}));

import { TenantGateService } from '../src/license/tenant-gate.service.js';
import { consumeQuota } from '../src/platform/tenant-quota.service.js';
import { setConfig, resetConfig } from './__setup__/test-helpers.js';

const consumeMock = consumeQuota as unknown as jest.MockedFunction<any>;

function makeSvc(tenantId = 't1'): TenantGateService {
  setConfig({ TENANT_ID: tenantId });
  return new TenantGateService({} as any);
}

function quotaExceeded(): HttpException {
  return new HttpException(
    { errCode: 'TENANT_QUOTA_EXCEEDED', limitColumn: 'max_chats', limit: 5, used: 5 },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

describe('TenantGateService.check', () => {
  beforeEach(() => {
    poolQuery.mockReset();
    consumeMock.mockReset();
  });
  afterEach(() => resetConfig());

  it('TENANT_ID 为空 → 放行且不查库/不消耗', async () => {
    const d = await makeSvc('').check(true);
    expect(d).toEqual({ allowed: true });
    expect(poolQuery).not.toHaveBeenCalled();
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it('租户不存在 → 放行（配置错误容错）', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const d = await makeSvc().check(false);
    expect(d).toEqual({ allowed: true });
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it('租户 paused → tenant-inactive', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'paused' }] });
    const d = await makeSvc().check(false);
    expect(d).toEqual({ allowed: false, reason: 'tenant-inactive' });
    expect(consumeMock).not.toHaveBeenCalled();
  });

  it('租户 terminated → tenant-inactive', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'terminated' }] });
    const d = await makeSvc().check(false);
    expect(d).toEqual({ allowed: false, reason: 'tenant-inactive' });
  });

  it('租户 grace → 放行（宽限期仍服务）', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'grace' }] });
    consumeMock.mockResolvedValueOnce({ allowed: true, limit: 5000, used: 1, limitColumn: 'max_api_calls' });
    const d = await makeSvc().check(false);
    expect(d).toEqual({ allowed: true });
  });

  it('active + 非新群 + 配额充足 → 放行（只消耗 api_call）', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    consumeMock.mockResolvedValueOnce({ allowed: true, limit: 5000, used: 1, limitColumn: 'max_api_calls' });

    const d = await makeSvc().check(false);

    expect(d).toEqual({ allowed: true });
    expect(consumeMock).toHaveBeenCalledTimes(1);
    expect(consumeMock.mock.calls[0][1]).toMatchObject({ tenantId: 't1', kind: 'api_call' });
  });

  it('active + 新群 + 配额充足 → 放行（chat + api_call 各一次）', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    consumeMock.mockResolvedValue({ allowed: true, limit: 5, used: 1, limitColumn: 'max_chats' });

    const d = await makeSvc().check(true);

    expect(d).toEqual({ allowed: true });
    expect(consumeMock).toHaveBeenCalledTimes(2);
    expect(consumeMock.mock.calls[0][1]).toMatchObject({ kind: 'chat' });
    expect(consumeMock.mock.calls[1][1]).toMatchObject({ kind: 'api_call' });
  });

  it('新群 chat 超限 → tenant-chat-limit，且不再消耗 api_call', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    consumeMock.mockRejectedValueOnce(quotaExceeded());

    const d = await makeSvc().check(true);

    expect(d).toEqual({ allowed: false, reason: 'tenant-chat-limit' });
    expect(consumeMock).toHaveBeenCalledTimes(1);
  });

  it('消息 api_call 超限 → tenant-msg-limit', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    consumeMock.mockRejectedValueOnce(quotaExceeded());

    const d = await makeSvc().check(false);

    expect(d).toEqual({ allowed: false, reason: 'tenant-msg-limit' });
  });

  it('消耗抛非超限错误（DB 故障）→ 放行', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ status: 'active' }] });
    consumeMock.mockRejectedValueOnce(new Error('db down'));

    const d = await makeSvc().check(false);

    expect(d).toEqual({ allowed: true });
  });

  it('状态查询抛错（表未建/DB 故障）→ 放行', async () => {
    poolQuery.mockRejectedValueOnce(new Error('relation does not exist'));

    const d = await makeSvc().check(false);

    expect(d).toEqual({ allowed: true });
  });
});
