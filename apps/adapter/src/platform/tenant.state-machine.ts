/**
 * TenantStateMachine — M11 租户生命周期转移表
 *
 * 合法转移（design D2 + spec 扩展）：
 *   created           → provisioning
 *   provisioning      → active | provisioning_failed
 *   active            → grace | suspended | terminated | paused
 *   grace             → active | suspended | paused
 *   suspended         → active | terminated
 *   paused            → active | terminated
 *   active|grace|suspended|paused → offboarding → terminated
 *   provisioning_failed → terminated
 *
 * 任何非法转移抛 IllegalTenantTransition（HTTP 409）。
 */

import { HttpException, HttpStatus } from '@nestjs/common';
import type { TenantStatus } from './tenant.entity.js';

export class IllegalTenantTransition extends HttpException {
  constructor(from: TenantStatus, to: TenantStatus) {
    super(
      {
        errCode: 'ILLEGAL_TENANT_TRANSITION',
        detail: `cannot transition tenant from "${from}" to "${to}"`,
        from,
        to,
      },
      HttpStatus.CONFLICT,
    );
  }
}

const TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  created: ['provisioning'],
  trialing: ['active', 'terminated'],
  provisioning: ['active', 'provisioning_failed'],
  active: ['grace', 'suspended', 'terminated', 'paused', 'offboarding'],
  grace: ['active', 'suspended', 'paused', 'terminated', 'offboarding'],
  // suspended 与 paused 互为别名（概设用 suspended，旧数据用 paused）
  suspended: ['active', 'terminated', 'offboarding'],
  paused: ['active', 'terminated', 'offboarding'],
  offboarding: ['terminated'],
  terminated: [],
  provisioning_failed: ['provisioning', 'terminated'],
};

export class TenantStateMachine {
  static assertTransition(from: TenantStatus, to: TenantStatus): void {
    const allowed = TRANSITIONS[from];
    if (allowed === undefined || !allowed.includes(to)) {
      throw new IllegalTenantTransition(from, to);
    }
  }
}
