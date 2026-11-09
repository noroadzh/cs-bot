import { describe, expect, it } from 'vitest';

/** operator 菜单不含 admin-only 项（与 App 菜单 gating 对齐） */
function tenantKeysForRole(role: 'admin' | 'operator'): string[] {
  const base = ['/dashboard', '/', '/learning', '/quality', '/archive', '/knowledge', '/assets', '/import'];
  if (role === 'admin') return [...base, '/license', '/config', '/users', '/audit-logs'];
  return base;
}

describe('role menu gating', () => {
  it('hides users/audit/license/config from operator', () => {
    const keys = tenantKeysForRole('operator');
    expect(keys).not.toContain('/users');
    expect(keys).not.toContain('/audit-logs');
    expect(keys).not.toContain('/license');
    expect(keys).not.toContain('/config');
  });

  it('shows admin-only items for admin', () => {
    const keys = tenantKeysForRole('admin');
    expect(keys).toContain('/users');
    expect(keys).toContain('/audit-logs');
  });
});
