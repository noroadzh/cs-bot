/**
 * 可观测性单测：全局异常过滤器 / 请求上下文 trace / 脱敏工具
 */
import { describe, it, expect, jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';
import { requestContext, currentTraceId, hashId, truncate } from '../src/common/request-context.js';

function makeHost() {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    headersSent: false,
  };
  const request = { method: 'GET', path: '/x' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  };
  return { host: host as any, response };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('HttpException 保持状态码与响应体', () => {
    const { host, response } = makeHost();
    filter.catch(new NotFoundException({ errCode: 'TENANT_NOT_FOUND', detail: 'nope' }), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ errCode: 'TENANT_NOT_FOUND' }),
    );
  });

  it('未知异常返回 500 统一体且不泄露 stack', () => {
    const { host, response } = makeHost();
    filter.catch(new Error('boom-secret-stack'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    const body = (response.json as jest.Mock).mock.calls[0][0] as any;
    expect(body.errCode).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('boom-secret-stack');
  });
});

describe('request-context', () => {
  it('run 内 currentTraceId 可见，run 外不可见', () => {
    expect(currentTraceId()).toBeUndefined();
    requestContext.run({ traceId: 't-1' }, () => {
      expect(currentTraceId()).toBe('t-1');
    });
    expect(currentTraceId()).toBeUndefined();
  });
});

describe('redaction helpers', () => {
  it('hashId 稳定短哈希', () => {
    expect(hashId('chat-abc')).toMatch(/^[0-9a-f]{12}$/);
    expect(hashId('chat-abc')).toBe(hashId('chat-abc'));
    expect(hashId(null)).toBe('');
  });

  it('truncate 保留长度线索', () => {
    const s = 'a'.repeat(50);
    const out = truncate(s, 10);
    expect(out.startsWith('a'.repeat(10))).toBe(true);
    expect(out).toContain('len=50');
  });
});
