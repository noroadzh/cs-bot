/**
 * TenantOffboarding — 双签注销与数据导出（概设 §5 M11 注销）
 *
 * 导出包生成与删除动作经接口注入；destroy 必须双签（≥2 approvals）。
 */
export interface OffboardingDeps {
  exportPackage(tenantId: string): Promise<string>;
  deleteTenant(tenantId: string): Promise<void>;
}

export class OffboardingBlockedException extends Error {
  readonly code = 'TENANT_OFFBOARDING_BLOCKED';
  constructor(
    readonly tenantId: string,
    readonly approvals: number,
  ) {
    super(`dual sign-off required: got ${approvals} approval(s)`);
    this.name = 'OffboardingBlockedException';
  }
}

export class TenantOffboarding {
  constructor(private readonly deps: OffboardingDeps) {}

  async export(tenantId: string): Promise<string> {
    return this.deps.exportPackage(tenantId);
  }

  async destroy(
    tenantId: string,
    approvals: readonly string[],
  ): Promise<{ deleted: boolean; approvals: number }> {
    if (approvals.length < 2) {
      throw new OffboardingBlockedException(tenantId, approvals.length);
    }
    await this.deps.deleteTenant(tenantId);
    return { deleted: true, approvals: approvals.length };
  }
}
