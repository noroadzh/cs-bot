/**
 * RBAC 后：supertest 冒烟需让 pg mock 返回可校验的 admin_user 行。
 */
import { hashPassword } from '../../src/admin/password-hasher.js';

export type AdminDbUser = {
  id: string;
  username: string;
  password_hash: string;
  role_code: string;
  enabled: boolean;
};

export async function makeAdminDbUser(opts: {
  username?: string;
  password: string;
  roleCode?: string;
}): Promise<AdminDbUser> {
  return {
    id: 'admin-u1',
    username: (opts.username ?? 'admin').trim().toLowerCase(),
    password_hash: await hashPassword(opts.password),
    role_code: opts.roleCode ?? 'admin',
    enabled: true,
  };
}

/** 若 SQL 命中 admin_user 按用户名查询，返回该用户行；否则 null（交给原 mock）。 */
export function adminUserQueryResult(
  sql: string,
  params: unknown[] | undefined,
  user: AdminDbUser,
): { rows: AdminDbUser[] } | null {
  if (!/FROM\s+admin_user/i.test(sql) || !/username\s*=\s*\$1/i.test(sql)) return null;
  const want = String(params?.[0] ?? '').trim().toLowerCase();
  if (want === user.username) return { rows: [user] };
  return { rows: [] };
}
