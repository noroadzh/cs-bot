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
  provisioning: ['active', 'provisioning_failed'],
  active: ['grace', 'suspended', 'terminated', 'paused'],
  grace: ['active', 'suspended', 'paused', 'terminated'],
  suspended: ['active', 'terminated'],
  paused: ['active', 'terminated'],
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
