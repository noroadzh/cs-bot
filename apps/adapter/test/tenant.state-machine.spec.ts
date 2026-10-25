/**
 * TenantStateMachine 单元测试
 *
 * 覆盖：
 *   - 所有合法转移（spec state machine + design D2）
 *   - 非法转移抛 IllegalTenantTransition（HTTP 409）
 *   - 同一 status → 同一 status 不合法（除了 pause 特殊）
 */
import { describe, it, expect } from '@jest/globals';

import { TenantStateMachine, IllegalTenantTransition } from '../src/platform/tenant.state-machine.js';
import type { TenantStatus } from '../src/platform/tenant.entity.js';

// ---- 合法转移 ----
describe('TenantStateMachine — legal transitions', () => {
  // design D2 + spec 扩展
  const legal: [TenantStatus, TenantStatus][] = [
    ['created', 'provisioning'],

    ['provisioning', 'active'],
    ['provisioning', 'provisioning_failed'],

    ['active', 'grace'],
    ['active', 'suspended'],
    ['active', 'terminated'],
    ['active', 'paused'],

    ['grace', 'active'],
    ['grace', 'suspended'],
    ['grace', 'paused'],
    ['grace', 'terminated'],

    ['suspended', 'active'],
    ['suspended', 'terminated'],

    ['paused', 'active'],
    ['paused', 'terminated'],

    ['provisioning_failed', 'terminated'],
  ];

  for (const [from, to] of legal) {
    it(`should allow ${from} → ${to}`, () => {
      expect(() => TenantStateMachine.assertTransition(from, to)).not.toThrow();
    });
  }
});

// ---- 非法转移 ----
describe('TenantStateMachine — illegal transitions', () => {
  const illegal: [TenantStatus, TenantStatus][] = [
    // created 只能进 provisioning
    ['created', 'active'],
    ['created', 'grace'],
    ['created', 'paused'],
    ['created', 'suspended'],
    ['created', 'terminated'],
    ['created', 'provisioning_failed'],

    // provisioning 只能进 active / provisioning_failed
    ['provisioning', 'created'],
    ['provisioning', 'grace'],
    ['provisioning', 'paused'],
    ['provisioning', 'suspended'],
    ['provisioning', 'terminated'],

    // active 不能回到 created / provisioning
    ['active', 'created'],
    ['active', 'provisioning'],
    ['active', 'provisioning_failed'],

    // grace 不能回到 created / provisioning
    ['grace', 'created'],
    ['grace', 'provisioning'],
    ['grace', 'provisioning_failed'],

    // suspended 不能回到 created / provisioning / grace / paused
    ['suspended', 'created'],
    ['suspended', 'provisioning'],
    ['suspended', 'grace'],
    ['suspended', 'paused'],
    ['suspended', 'provisioning_failed'],

    // paused 不能回到 created / provisioning / grace / suspended
    ['paused', 'created'],
    ['paused', 'provisioning'],
    ['paused', 'grace'],
    ['paused', 'suspended'],
    ['paused', 'provisioning_failed'],

    // terminated — 终态，无出边
    ['terminated', 'active'],
    ['terminated', 'grace'],
    ['terminated', 'paused'],
    ['terminated', 'suspended'],
    ['terminated', 'provisioning'],
    ['terminated', 'provisioning_failed'],

    // provisioning_failed 不能回到 active / grace / paused / suspended
    ['provisioning_failed', 'active'],
    ['provisioning_failed', 'grace'],
    ['provisioning_failed', 'paused'],
    ['provisioning_failed', 'suspended'],
  ];

  for (const [from, to] of illegal) {
    it(`should reject ${from} → ${to}`, () => {
      try {
        TenantStateMachine.assertTransition(from, to);
        fail(`Expected IllegalTenantTransition for ${from} → ${to}`);
      } catch (err) {
        expect(err).toBeInstanceOf(IllegalTenantTransition);
        expect((err as IllegalTenantTransition).getResponse()).toMatchObject({
          errCode: 'ILLEGAL_TENANT_TRANSITION',
          from,
          to,
        });
      }
    });
  }
});

// ---- IllegalTenantTransition 构造 ----
describe('IllegalTenantTransition', () => {
  it('should be HttpException with status 409', () => {
    const err = new IllegalTenantTransition('active', 'created');
    expect(err.getStatus()).toBe(409);
    expect(err.getResponse()).toMatchObject({
      errCode: 'ILLEGAL_TENANT_TRANSITION',
      detail: expect.stringContaining('active'),
      from: 'active',
      to: 'created',
    });
  });
});