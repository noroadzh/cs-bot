import { describe, it, expect } from '@jest/globals';
import { PlatformReasonGuard } from '../src/platform/platform.controller.js';
import { requestContext } from '../src/common/request-context.js';

const ctx = (method: string, body: any, headers: any = {}): any => ({
  switchToHttp: () => ({ getRequest: () => ({ method, body, headers }) }),
});

describe('PlatformReasonGuard', () => {
  const guard = new PlatformReasonGuard();

  it('allows GET without reason', () => {
    expect(guard.canActivate(ctx('GET', undefined))).toBe(true);
  });

  it('rejects a mutation without reason', () => {
    expect(() => guard.canActivate(ctx('POST', {}))).toThrow();
  });

  it('accepts body reason and stores it in request context', async () => {
    await requestContext.run({ traceId: 't' }, () => {
      expect(guard.canActivate(ctx('POST', { reason: 'ops request' }))).toBe(true);
      expect(requestContext.getStore()?.auditReason).toBe('ops request');
    });
  });

  it('accepts x-operator-reason header', () => {
    expect(guard.canActivate(ctx('POST', {}, { 'x-operator-reason': 'ticket-1' }))).toBe(true);
  });
});
